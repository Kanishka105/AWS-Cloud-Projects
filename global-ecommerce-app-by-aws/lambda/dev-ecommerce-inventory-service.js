// Use AWS SDK v3 for Node.js 18.x
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

// Initialize clients
const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const eventbridge = new EventBridgeClient({ region: process.env.AWS_REGION });

const INVENTORY_TABLE = process.env.INVENTORY_TABLE;
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

const createResponse = (statusCode, body, additionalHeaders = {}) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        ...additionalHeaders
    },
    body: JSON.stringify(body)
});

exports.handler = async (event) => {
    console.log('Inventory Service Event:', JSON.stringify(event, null, 2));
    const { httpMethod, pathParameters, body, queryStringParameters } = event;
    
    try {
        // Handle OPTIONS for CORS
        if (httpMethod === 'OPTIONS') {
            return createResponse(200, { message: 'CORS preflight' });
        }
        
        switch (httpMethod) {
            case 'POST':
                if (!body) {
                    return createResponse(400, { error: 'Request body required' });
                }
                return await updateInventory(JSON.parse(body));
                
            case 'GET':
                if (pathParameters && pathParameters.productId) {
                    return await getInventory(pathParameters.productId);
                }
                return await getAllInventory(queryStringParameters);
                
            case 'PUT':
                if (!pathParameters?.productId || !body) {
                    return createResponse(400, { error: 'Product ID and body required' });
                }
                return await reserveInventory(pathParameters.productId, JSON.parse(body));
                
            default:
                return createResponse(405, { error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('Inventory Service Error:', error);
        return createResponse(500, { 
            error: 'Internal server error', 
            message: error.message 
        });
    }
};

async function updateInventory(inventoryData) {
    const timestamp = new Date().toISOString();
    
    try {
        // Validate required fields
        if (!inventoryData.productId) {
            return createResponse(400, { error: 'Product ID is required' });
        }
        
        // Handle new inventory item creation
        if (inventoryData.isNewItem === true) {
            const newInventory = {
                productId: inventoryData.productId,
                quantity: inventoryData.quantity || 0,
                reservedQuantity: 0,
                reorderLevel: inventoryData.reorderLevel || 10,
                maxStock: inventoryData.maxStock || 1000,
                location: inventoryData.location || 'WAREHOUSE-A',
                createdAt: timestamp,
                updatedAt: timestamp
            };
            
            try {
                await dynamodb.send(new PutCommand({
                    TableName: INVENTORY_TABLE,
                    Item: newInventory,
                    ConditionExpression: 'attribute_not_exists(productId)'
                }));
                
                await publishEvent('ecommerce.inventory', 'Inventory Created', {
                    productId: inventoryData.productId,
                    initialQuantity: newInventory.quantity,
                    location: newInventory.location,
                    timestamp
                });
                
                return createResponse(201, { 
                    message: 'Inventory created successfully',
                    inventory: newInventory 
                });
            } catch (error) {
                if (error.name === 'ConditionalCheckFailedException') {
                    return createResponse(400, { 
                        error: 'Inventory already exists for this product'
                    });
                }
                throw error;
            }
        }
        
        // Handle inventory quantity updates
        if (inventoryData.quantityChange === undefined) {
            return createResponse(400, { error: 'Quantity change is required for updates' });
        }
        
        // First, get current inventory to check if it exists
        const currentResult = await dynamodb.send(new GetCommand({
            TableName: INVENTORY_TABLE,
            Key: { productId: inventoryData.productId }
        }));
        
        if (!currentResult.Item) {
            return createResponse(404, { 
                error: 'Inventory not found. Create inventory first using isNewItem: true'
            });
        }
        
        const currentQuantity = currentResult.Item.quantity || 0;
        const newQuantity = currentQuantity + inventoryData.quantityChange;
        
        if (newQuantity < 0) {
            return createResponse(400, { 
                error: 'Cannot reduce inventory below zero',
                currentQuantity: currentQuantity,
                requestedChange: inventoryData.quantityChange,
                resultingQuantity: newQuantity
            });
        }
        
        // Update the inventory
        const result = await dynamodb.send(new UpdateCommand({
            TableName: INVENTORY_TABLE,
            Key: { productId: inventoryData.productId },
            UpdateExpression: 'SET quantity = :newQuantity, updatedAt = :timestamp',
            ExpressionAttributeValues: {
                ':newQuantity': newQuantity,
                ':timestamp': timestamp
            },
            ReturnValues: 'ALL_NEW'
        }));
        
        // Check for low stock alert
        const reorderLevel = result.Attributes.reorderLevel || 10;
        
        if (newQuantity <= reorderLevel) {
            await publishEvent('ecommerce.inventory', 'Low Stock Alert', {
                productId: inventoryData.productId,
                currentQuantity: newQuantity,
                reorderLevel: reorderLevel,
                timestamp
            });
        }
        
        // Publish inventory update event
        await publishEvent('ecommerce.inventory', 'Inventory Updated', {
            productId: inventoryData.productId,
            newQuantity: newQuantity,
            change: inventoryData.quantityChange,
            timestamp
        });
        
        return createResponse(200, { 
            message: 'Inventory updated successfully',
            inventory: result.Attributes 
        });
        
    } catch (error) {
        console.error('Update inventory error:', error);
        return createResponse(500, { 
            error: 'Failed to update inventory',
            message: error.message 
        });
    }
}

async function getInventory(productId) {
    try {
        const result = await dynamodb.send(new GetCommand({
            TableName: INVENTORY_TABLE,
            Key: { productId }
        }));
        
        if (!result.Item) {
            return createResponse(404, { error: 'Inventory not found for this product' });
        }
        
        // Calculate available quantity (total - reserved)
        const inventory = result.Item;
        inventory.availableQuantity = (inventory.quantity || 0) - (inventory.reservedQuantity || 0);
        inventory.stockStatus = getStockStatus(inventory);
        
        return createResponse(200, { inventory });
        
    } catch (error) {
        console.error('Get inventory error:', error);
        return createResponse(500, { 
            error: 'Failed to get inventory',
            message: error.message 
        });
    }
}

async function getAllInventory(queryParams) {
    try {
        let params = { TableName: INVENTORY_TABLE };
        
        // Filter by low stock if requested
        if (queryParams && queryParams.lowStock === 'true') {
            params.FilterExpression = 'quantity <= reorderLevel';
        }
        
        // Filter by location if specified
        if (queryParams && queryParams.location) {
            if (params.FilterExpression) {
                params.FilterExpression += ' AND #location = :location';
            } else {
                params.FilterExpression = '#location = :location';
            }
            params.ExpressionAttributeNames = { '#location': 'location' };
            params.ExpressionAttributeValues = { ':location': queryParams.location };
        }
        
        const result = await dynamodb.send(new ScanCommand(params));
        
        // Enhance inventory items with calculated fields
        const enhancedInventory = (result.Items || []).map(item => ({
            ...item,
            availableQuantity: (item.quantity || 0) - (item.reservedQuantity || 0),
            stockStatus: getStockStatus(item)
        }));
        
        // Calculate summary statistics
        const totalItems = enhancedInventory.length;
        const lowStockItems = enhancedInventory.filter(item => item.stockStatus === 'LOW').length;
        const outOfStockItems = enhancedInventory.filter(item => item.stockStatus === 'OUT_OF_STOCK').length;
        const totalQuantity = enhancedInventory.reduce((sum, item) => sum + (item.quantity || 0), 0);
        const totalReserved = enhancedInventory.reduce((sum, item) => sum + (item.reservedQuantity || 0), 0);
        
        return createResponse(200, { 
            inventory: enhancedInventory,
            count: result.Count || 0,
            summary: {
                totalItems,
                lowStockItems,
                outOfStockItems,
                totalQuantity,
                totalReserved,
                totalAvailable: totalQuantity - totalReserved
            }
        });
        
    } catch (error) {
        console.error('Get all inventory error:', error);
        return createResponse(500, { 
            error: 'Failed to get inventory',
            message: error.message 
        });
    }
}

async function reserveInventory(productId, reservationData) {
    const timestamp = new Date().toISOString();
    
    try {
        // Validate required fields
        if (!reservationData.quantity || reservationData.quantity <= 0) {
            return createResponse(400, { error: 'Valid quantity is required for reservation' });
        }
        
        // First, get current inventory
        const currentResult = await dynamodb.send(new GetCommand({
            TableName: INVENTORY_TABLE,
            Key: { productId }
        }));
        
        if (!currentResult.Item) {
            return createResponse(404, { error: 'Inventory not found for this product' });
        }
        
        const currentInventory = currentResult.Item;
        const currentReserved = currentInventory.reservedQuantity || 0;
        const newReserved = currentReserved + reservationData.quantity;
        const availableAfterReservation = (currentInventory.quantity || 0) - newReserved;
        
        if (availableAfterReservation < 0) {
            return createResponse(400, { 
                success: false, 
                error: 'Insufficient inventory',
                available: (currentInventory.quantity || 0) - currentReserved,
                requested: reservationData.quantity
            });
        }
        
        // Update reserved quantity
        const result = await dynamodb.send(new UpdateCommand({
            TableName: INVENTORY_TABLE,
            Key: { productId },
            UpdateExpression: 'SET reservedQuantity = :newReserved, updatedAt = :timestamp',
            ExpressionAttributeValues: {
                ':newReserved': newReserved,
                ':timestamp': timestamp
            },
            ReturnValues: 'ALL_NEW'
        }));
        
        // Publish reservation event
        await publishEvent('ecommerce.inventory', 'Inventory Reserved', {
            productId: productId,
            reservedQuantity: reservationData.quantity,
            totalReserved: result.Attributes.reservedQuantity,
            availableQuantity: result.Attributes.quantity - result.Attributes.reservedQuantity,
            orderId: reservationData.orderId || null,
            timestamp
        });
        
        return createResponse(200, { 
            success: true,
            message: 'Inventory reserved successfully',
            inventory: {
                ...result.Attributes,
                availableQuantity: result.Attributes.quantity - result.Attributes.reservedQuantity
            }
        });
        
    } catch (error) {
        console.error('Reserve inventory error:', error);
        return createResponse(500, { 
            error: 'Failed to reserve inventory',
            message: error.message 
        });
    }
}

function getStockStatus(inventory) {
    const available = (inventory.quantity || 0) - (inventory.reservedQuantity || 0);
    const reorderLevel = inventory.reorderLevel || 10;
    
    if (available <= 0) return 'OUT_OF_STOCK';
    if (available <= reorderLevel) return 'LOW';
    return 'IN_STOCK';
}

async function publishEvent(source, detailType, detail) {
    try {
        const command = new PutEventsCommand({
            Entries: [{
                Source: source,
                DetailType: detailType,
                Detail: JSON.stringify(detail),
                EventBusName: EVENT_BUS_NAME
            }]
        });
        
        await eventbridge.send(command);
        console.log('Event published successfully:', detailType);
        
    } catch (error) {
        console.error('Failed to publish event:', error);
        // Don't fail the main operation if event publishing fails
    }
}
