// Use the new AWS SDK v3 for Node.js 18.x
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize DynamoDB client
const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const ORDERS_TABLE = process.env.ORDERS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

// CORS headers helper
const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS'
};

const createResponse = (statusCode, body) => ({
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body)
});

exports.handler = async (event) => {
    console.log('Search Service Event:', JSON.stringify(event, null, 2));
    
    const { httpMethod, pathParameters, queryStringParameters } = event;
    
    try {
        // Handle OPTIONS for CORS
        if (httpMethod === 'OPTIONS') {
            return createResponse(200, { message: 'CORS preflight' });
        }
        
        // Handle GET requests
        if (httpMethod === 'GET') {
            // Check if it's /{searchType} path
            if (pathParameters && pathParameters.searchType) {
                return await searchByType(pathParameters.searchType, queryStringParameters);
            }
            
            // Handle /search path (general search)
            return await generalSearch(queryStringParameters);
        }
        
        // Handle PUT requests (for search preferences/filters)
        if (httpMethod === 'PUT') {
            return await updateSearchPreferences(event.body);
        }
        
        return createResponse(405, { error: 'Method not allowed' });
        
    } catch (error) {
        console.error('Search Error:', error);
        return createResponse(500, { 
            error: 'Internal server error', 
            message: error.message 
        });
    }
};

// General search across products
async function generalSearch(queryParams) {
    const searchTerm = queryParams?.q || queryParams?.query || queryParams?.search;
    
    if (!searchTerm) {
        return createResponse(400, { 
            error: 'Search term required',
            usage: 'Use ?q=searchterm or ?search=searchterm',
            examples: [
                '/search?q=laptop',
                '/search?search=electronics',
                '/search/category?q=books'
            ]
        });
    }
    
    try {
        const command = new ScanCommand({
            TableName: PRODUCTS_TABLE,
            FilterExpression: 'contains(#name, :searchTerm) OR contains(description, :searchTerm) OR contains(category, :searchTerm)',
            ExpressionAttributeNames: {
                '#name': 'name'
            },
            ExpressionAttributeValues: {
                ':searchTerm': searchTerm
            }
        });
        
        const result = await dynamodb.send(command);
        
        // Sort by relevance (name matches first, then description, then category)
        const sortedResults = result.Items.sort((a, b) => {
            const aNameMatch = a.name?.toLowerCase().includes(searchTerm.toLowerCase()) ? 3 : 0;
            const aDescMatch = a.description?.toLowerCase().includes(searchTerm.toLowerCase()) ? 2 : 0;
            const aCatMatch = a.category?.toLowerCase().includes(searchTerm.toLowerCase()) ? 1 : 0;
            
            const bNameMatch = b.name?.toLowerCase().includes(searchTerm.toLowerCase()) ? 3 : 0;
            const bDescMatch = b.description?.toLowerCase().includes(searchTerm.toLowerCase()) ? 2 : 0;
            const bCatMatch = b.category?.toLowerCase().includes(searchTerm.toLowerCase()) ? 1 : 0;
            
            return (bNameMatch + bDescMatch + bCatMatch) - (aNameMatch + aDescMatch + aCatMatch);
        });
        
        return createResponse(200, {
            products: sortedResults,
            count: result.Count || 0,
            searchTerm: searchTerm,
            searchType: 'general',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('DynamoDB Error:', error);
        return createResponse(500, { error: 'Failed to search products' });
    }
}

// Search by specific type
async function searchByType(searchType, queryParams) {
    const searchTerm = queryParams?.q || queryParams?.query;
    
    let command;
    
    try {
        switch (searchType.toLowerCase()) {
            case 'name':
                if (!searchTerm) {
                    return createResponse(400, { error: 'Search term required for name search' });
                }
                command = new ScanCommand({
                    TableName: PRODUCTS_TABLE,
                    FilterExpression: 'contains(#name, :searchTerm)',
                    ExpressionAttributeNames: { '#name': 'name' },
                    ExpressionAttributeValues: { ':searchTerm': searchTerm }
                });
                break;
                
            case 'category':
                if (!searchTerm) {
                    return createResponse(400, { error: 'Category name required' });
                }
                command = new ScanCommand({
                    TableName: PRODUCTS_TABLE,
                    FilterExpression: 'category = :category',
                    ExpressionAttributeValues: { ':category': searchTerm }
                });
                break;
                
            case 'price':
                const minPrice = parseFloat(queryParams?.min || 0);
                const maxPrice = parseFloat(queryParams?.max || 999999);
                command = new ScanCommand({
                    TableName: PRODUCTS_TABLE,
                    FilterExpression: 'price BETWEEN :minPrice AND :maxPrice',
                    ExpressionAttributeValues: {
                        ':minPrice': minPrice,
                        ':maxPrice': maxPrice
                    }
                });
                break;
                
            case 'popular':
                // Get products and sort by a popularity metric
                command = new ScanCommand({
                    TableName: PRODUCTS_TABLE,
                    FilterExpression: 'attribute_exists(#name)',
                    ExpressionAttributeNames: { '#name': 'name' }
                });
                break;
                
            case 'recent':
                // Get recently added products (last 30 days)
                const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                command = new ScanCommand({
                    TableName: PRODUCTS_TABLE,
                    FilterExpression: 'createdAt >= :recentDate',
                    ExpressionAttributeValues: { ':recentDate': thirtyDaysAgo }
                });
                break;
                
            default:
                return createResponse(400, { 
                    error: 'Invalid search type',
                    validTypes: ['name', 'category', 'price', 'popular', 'recent'],
                    examples: [
                        '/search/name?q=laptop',
                        '/search/category?q=electronics',
                        '/search/price?min=10&max=100',
                        '/search/popular',
                        '/search/recent'
                    ]
                });
        }
        
        const result = await dynamodb.send(command);
        
        // Sort results based on search type
        let sortedResults = result.Items;
        if (searchType === 'popular') {
            // Sort by price descending as a simple popularity metric
            sortedResults = result.Items.sort((a, b) => (b.price || 0) - (a.price || 0));
        } else if (searchType === 'recent') {
            // Sort by creation date descending
            sortedResults = result.Items.sort((a, b) => 
                new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
            );
        }
        
        return createResponse(200, {
            products: sortedResults,
            count: result.Count || 0,
            searchType: searchType,
            searchTerm: searchTerm,
            filters: queryParams,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('DynamoDB Error:', error);
        return createResponse(500, { error: `Failed to search by ${searchType}` });
    }
}

// Update search preferences (for PUT requests)
async function updateSearchPreferences(body) {
    if (!body) {
        return createResponse(400, { error: 'Request body required' });
    }
    
    try {
        const preferences = JSON.parse(body);
        
        // Here you could save user search preferences to a database
        // For now, just return the preferences
        return createResponse(200, {
            message: 'Search preferences updated',
            preferences: preferences,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        return createResponse(400, { error: 'Invalid JSON in request body' });
    }
}
