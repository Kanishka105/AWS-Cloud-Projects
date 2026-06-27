const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
    console.log('Event received:', JSON.stringify(event));
    
    try {
        const [usersResult, productsResult, ordersResult, paymentsResult] = await Promise.all([
            dynamodb.send(new ScanCommand({ 
                TableName: process.env.USERS_TABLE,
                Select: 'COUNT'
            })),
            dynamodb.send(new ScanCommand({ 
                TableName: process.env.PRODUCTS_TABLE,
                Select: 'COUNT'
            })),
            dynamodb.send(new ScanCommand({ 
                TableName: process.env.ORDERS_TABLE,
                Select: 'COUNT'
            })),
            dynamodb.send(new ScanCommand({ 
                TableName: process.env.PAYMENTS_TABLE,
                Select: 'COUNT'
            }))
        ]);

        const totalUsers = usersResult.Count || 0;
        const totalProducts = productsResult.Count || 0;
        const totalOrders = ordersResult.Count || 0;
        const totalPayments = paymentsResult.Count || 0;

        const dashboard = {
            totalRevenue: 0,
            totalOrders: totalOrders,
            totalUsers: totalUsers,
            totalProducts: totalProducts,
            totalPayments: totalPayments,
            averageOrderValue: 0,
            conversionRate: "0.00"
        };

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ dashboard })
        };

    } catch (error) {
        console.error('Error:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        };
    }
};
