const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;

const createResponse = (statusCode, body) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify(body)
});

exports.handler = async (event) => {
    console.log('Event received:', JSON.stringify(event, null, 2));
    
    const { httpMethod, pathParameters, body } = event;
    
    try {
        switch (httpMethod) {
            case 'GET':
                if (pathParameters && pathParameters.productId) {
                    return await getProduct(pathParameters.productId);
                }
                return await getProducts();
                
            case 'POST':
                if (!body) {
                    return createResponse(400, { error: 'Request body required' });
                }
                return await createProduct(JSON.parse(body));
                
            case 'PUT':
                if (!pathParameters?.productId || !body) {
                    return createResponse(400, { error: 'Product ID and body required' });
                }
                return await updateProduct(pathParameters.productId, JSON.parse(body));
                
            case 'DELETE':
                if (!pathParameters?.productId) {
                    return createResponse(400, { error: 'Product ID required' });
                }
                return await deleteProduct(pathParameters.productId);
                
            case 'OPTIONS':
                return createResponse(200, { message: 'CORS preflight' });
                
            default:
                return createResponse(405, { error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('Error:', error);
        return createResponse(500, { error: 'Internal server error', details: error.message });
    }
};

const getProducts = async () => {
    try {
        const command = new ScanCommand({
            TableName: PRODUCTS_TABLE
        });
        
        const result = await dynamodb.send(command);
        
        return createResponse(200, {
            products: result.Items || [],
            count: result.Count || 0
        });
    } catch (error) {
        console.error('DynamoDB error:', error);
        return createResponse(500, { error: 'Failed to fetch products' });
    }
};

const getProduct = async (productId) => {
    try {
        const command = new GetCommand({
            TableName: PRODUCTS_TABLE,
            Key: { productId }
        });
        
        const result = await dynamodb.send(command);
        
        if (!result.Item) {
            return createResponse(404, { error: 'Product not found' });
        }
        
        return createResponse(200, { product: result.Item });
    } catch (error) {
        console.error('DynamoDB error:', error);
        return createResponse(500, { error: 'Failed to fetch product' });
    }
};

const createProduct = async (productData) => {
    try {
        const productId = `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toISOString();
        
        const product = {
            productId,
            ...productData,
            createdAt: timestamp,
            updatedAt: timestamp
        };
        
        const command = new PutCommand({
            TableName: PRODUCTS_TABLE,
            Item: product
        });
        
        await dynamodb.send(command);
        
        return createResponse(201, {
            message: 'Product created successfully',
            product
        });
    } catch (error) {
        console.error('DynamoDB error:', error);
        return createResponse(500, { error: 'Failed to create product' });
    }
};

const updateProduct = async (productId, updateData) => {
    try {
        const timestamp = new Date().toISOString();
        
        const command = new UpdateCommand({
            TableName: PRODUCTS_TABLE,
            Key: { productId },
            UpdateExpression: 'SET #name = :name, #desc = :desc, #price = :price, #category = :category, updatedAt = :updatedAt',
            ExpressionAttributeNames: {
                '#name': 'name',
                '#desc': 'description',
                '#price': 'price',
                '#category': 'category'
            },
            ExpressionAttributeValues: {
                ':name': updateData.name,
                ':desc': updateData.description,
                ':price': updateData.price,
                ':category': updateData.category,
                ':updatedAt': timestamp
            },
            ReturnValues: 'ALL_NEW'
        });
        
        const result = await dynamodb.send(command);
        
        return createResponse(200, {
            message: 'Product updated successfully',
            product: result.Attributes
        });
    } catch (error) {
        console.error('DynamoDB error:', error);
        return createResponse(500, { error: 'Failed to update product' });
    }
};

const deleteProduct = async (productId) => {
    try {
        const command = new DeleteCommand({
            TableName: PRODUCTS_TABLE,
            Key: { productId },
            ReturnValues: 'ALL_OLD'
        });
        
        const result = await dynamodb.send(command);
        
        if (!result.Attributes) {
            return createResponse(404, { error: 'Product not found' });
        }
        
        return createResponse(200, {
            message: 'Product deleted successfully',
            productId
        });
    } catch (error) {
        console.error('DynamoDB error:', error);
        return createResponse(500, { error: 'Failed to delete product' });
    }
};
