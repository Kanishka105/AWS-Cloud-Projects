// Use AWS SDK v3 for Node.js 18.x
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

// Initialize clients
const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const eventbridge = new EventBridgeClient({ region: process.env.AWS_REGION });

const ORDERS_TABLE = process.env.ORDERS_TABLE;
const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const INVENTORY_TABLE = process.env.INVENTORY_TABLE;
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
    console.log('Order Service Event:', JSON.stringify(event, null, 2));
    
    const { httpMethod, pathParameters, body } = event;
    
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
                return await createOrder(JSON.parse(body));
                
            case 'GET':
                if (pathParameters && pathParameters.orderId) {
                    return await getOrder(pathParameters.orderId);
                }
                return await getOrders();
                
            case 'PUT':
                if (!pathParameters?.orderId || !body) {
                    return createResponse(400, { error: 'Order ID and body required' });
                }
                return await updateOrderStatus(pathParameters.orderId, JSON.parse(body));
                
            default:
                return createResponse(405, { error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('Error:', error);
        return createResponse(500, { 
            error: 'Internal server error', 
            message: error.message 
        });
    }
};

async function createOrder(orderData) {
    const orderId = `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    try {
        // Validate required fields
        if (!orderData.userId || !orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0) {
            return createResponse(400, { 
                error: 'Missing required fields: userId and items array' 
            });
        }
        
        // Validate inventory for all items
        const inventoryChecks = await Promise.all(
            orderData.items.map(item => 
                dynamodb.send(new GetCommand({
                    TableName: INVENTORY_TABLE,
                    Key: { productId: item.productId }
                }))
            )
        );
        
        // Check if all items are available
        for (let i = 0; i < orderData.items.length; i++) {
            const item = orderData.items[i];
            const inventory = inventoryChecks[i].Item;
            
            if (!inventory || inventory.quantity < item.quantity) {
                return createResponse(400, { 
                    error: `Insufficient inventory for product ${item.productId}`,
                    available: inventory ? inventory.quantity : 0,
                    requested: item.quantity
                });
            }
        }
        
        // Get product details and calculate total
        const productDetails = await Promise.all(
            orderData.items.map(item =>
                dynamodb.send(new GetCommand({
                    TableName: PRODUCTS_TABLE,
                    Key: { productId: item.productId }
                }))
            )
        );
        
        let totalAmount = 0;
        const enrichedItems = orderData.items.map((item, index) => {
            const product = productDetails[index].Item;
            if (!product) {
                throw new Error(`Product ${item.productId} not found`);
            }
            
            const itemTotal = product.price * item.quantity;
            totalAmount += itemTotal;
            
            return {
                productId: item.productId,
                productName: product.name,
                quantity: item.quantity,
                unitPrice: product.price,
                totalPrice: itemTotal
            };
        });
        
        const order = {
            orderId,
            userId: orderData.userId,
            items: enrichedItems,
            totalAmount,
            currency: orderData.currency || 'USD',
            country: orderData.country || 'US',
            status: 'pending',
            shippingAddress: orderData.shippingAddress,
            billingAddress: orderData.billingAddress || orderData.shippingAddress,
            createdAt: timestamp,
            updatedAt: timestamp
        };
        
        // Save order to DynamoDB
        await dynamodb.send(new PutCommand({
            TableName: ORDERS_TABLE,
            Item: order
        }));
        
        // Reserve inventory
        await Promise.all(
            orderData.items.map(item =>
                dynamodb.send(new UpdateCommand({
                    TableName: INVENTORY_TABLE,
                    Key: { productId: item.productId },
                    UpdateExpression: 'SET reservedQuantity = if_not_exists(reservedQuantity, :zero) + :qty, updatedAt = :timestamp',
                    ExpressionAttributeValues: {
                        ':qty': item.quantity,
                        ':timestamp': timestamp,
                        ':zero': 0
                    }
                }))
            )
        );
        
        // Publish event to EventBridge
        await publishEvent('ecommerce.order', 'Order Created', {
            orderId: order.orderId,
            userId: order.userId,
            totalAmount: order.totalAmount,
            currency: order.currency,
            country: order.country,
            items: order.items,
            timestamp
        });
        
        return createResponse(201, { 
            message: 'Order created successfully',
            order 
        });
        
    } catch (error) {
        console.error('Create order error:', error);
        return createResponse(500, { 
            error: 'Failed to create order',
            message: error.message 
        });
    }
}

async function getOrder(orderId) {
    try {
        const result = await dynamodb.send(new GetCommand({
            TableName: ORDERS_TABLE,
            Key: { orderId }
        }));
        
        if (!result.Item) {
            return createResponse(404, { error: 'Order not found' });
        }
        
        return createResponse(200, { order: result.Item });
        
    } catch (error) {
        console.error('Get order error:', error);
        return createResponse(500, { 
            error: 'Failed to get order',
            message: error.message 
        });
    }
}

async function getOrders() {
    try {
        const result = await dynamodb.send(new ScanCommand({
            TableName: ORDERS_TABLE
        }));
        
        return createResponse(200, { 
            orders: result.Items || [],
            count: result.Count || 0
        });
        
    } catch (error) {
        console.error('Get orders error:', error);
        return createResponse(500, { 
            error: 'Failed to get orders',
            message: error.message 
        });
    }
}

async function updateOrderStatus(orderId, updateData) {
    const timestamp = new Date().toISOString();
    
    try {
        if (!updateData.status) {
            return createResponse(400, { error: 'Status is required' });
        }
        
        const result = await dynamodb.send(new UpdateCommand({
            TableName: ORDERS_TABLE,
            Key: { orderId },
            UpdateExpression: 'SET #status = :status, updatedAt = :timestamp',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': updateData.status,
                ':timestamp': timestamp
            },
            ReturnValues: 'ALL_NEW'
        }));
        
        if (!result.Attributes) {
            return createResponse(404, { error: 'Order not found' });
        }
        
        // Publish appropriate events based on status
        if (updateData.status === 'shipped') {
            await publishEvent('ecommerce.order', 'Order Shipped', {
                orderId: result.Attributes.orderId,
                userId: result.Attributes.userId,
                trackingNumber: updateData.trackingNumber || 'TRK' + Date.now(),
                carrier: updateData.carrier || 'Standard Shipping',
                estimatedDelivery: updateData.estimatedDelivery || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                timestamp
            });
        } else if (updateData.status === 'delivered') {
            await publishEvent('ecommerce.order', 'Order Delivered', {
                orderId: result.Attributes.orderId,
                userId: result.Attributes.userId,
                deliveredAt: timestamp,
                timestamp
            });
        }
        
        return createResponse(200, { 
            message: 'Order status updated successfully',
            order: result.Attributes 
        });
        
    } catch (error) {
        console.error('Update order error:', error);
        return createResponse(500, { 
            error: 'Failed to update order',
            message: error.message 
        });
    }
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
