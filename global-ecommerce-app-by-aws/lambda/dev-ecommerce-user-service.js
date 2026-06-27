// const AWS = require('aws-sdk');
// const dynamodb = new AWS.DynamoDB.DocumentClient();
// const eventbridge = new AWS.EventBridge();

// const USERS_TABLE = process.env.USERS_TABLE;
// const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

// // CORS headers helper - handles all CORS requirements
// const corsHeaders = {
//     'Content-Type': 'application/json',
//     'Access-Control-Allow-Origin': '*',
//     'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent',
//     'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
//     'Access-Control-Max-Age': '86400'
// };

// // CORS headers for responses without content-type (like 204)
// const corsHeadersNoContent = {
//     'Access-Control-Allow-Origin': '*',
//     'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent',
//     'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
//     'Access-Control-Max-Age': '86400'
// };

// exports.handler = async (event) => {
//     console.log('User Service Event:', JSON.stringify(event, null, 2));
    
//     const { httpMethod, pathParameters, body } = event;
    
//     try {
//         switch (httpMethod) {
//             case 'POST':
//                 return await createUser(JSON.parse(body || '{}'));
//             case 'GET':
//                 if (pathParameters && pathParameters.userId) {
//                     return await getUser(pathParameters.userId);
//                 }
//                 return await getAllUsers();
//             case 'PUT':
//                 if (!pathParameters || !pathParameters.userId) {
//                     return {
//                         statusCode: 400,
//                         headers: corsHeaders,
//                         body: JSON.stringify({ message: 'User ID is required for update' })
//                     };
//                 }
//                 return await updateUser(pathParameters.userId, JSON.parse(body || '{}'));
//             case 'DELETE':
//                 if (!pathParameters || !pathParameters.userId) {
//                     return {
//                         statusCode: 400,
//                         headers: corsHeaders,
//                         body: JSON.stringify({ message: 'User ID is required for deletion' })
//                     };
//                 }
//                 return await deleteUser(pathParameters.userId);
//             case 'OPTIONS':
//                 // Handle preflight CORS requests
//                 return {
//                     statusCode: 200,
//                     headers: corsHeaders,
//                     body: JSON.stringify({ message: 'CORS preflight successful' })
//                 };
//             default:
//                 return {
//                     statusCode: 405,
//                     headers: corsHeaders,
//                     body: JSON.stringify({ message: 'Method not allowed' })
//                 };
//         }
//     } catch (error) {
//         console.error('Error:', error);
        
//         // Handle JSON parsing errors
//         if (error instanceof SyntaxError) {
//             return {
//                 statusCode: 400,
//                 headers: corsHeaders,
//                 body: JSON.stringify({ message: 'Invalid JSON in request body', error: error.message })
//             };
//         }
        
//         // Handle DynamoDB errors
//         if (error.code === 'ValidationException') {
//             return {
//                 statusCode: 400,
//                 headers: corsHeaders,
//                 body: JSON.stringify({ message: 'Validation error', error: error.message })
//             };
//         }
        
//         if (error.code === 'ConditionalCheckFailedException') {
//             return {
//                 statusCode: 409,
//                 headers: corsHeaders,
//                 body: JSON.stringify({ message: 'Resource conflict', error: error.message })
//             };
//         }
        
//         // Generic server error
//         return {
//             statusCode: 500,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'Internal server error', error: error.message })
//         };
//     }
// };

// async function createUser(userData) {
//     // Validate required fields
//     if (!userData.email || !userData.firstName || !userData.lastName) {
//         return {
//             statusCode: 400,
//             headers: corsHeaders,
//             body: JSON.stringify({ 
//                 message: 'Missing required fields: email, firstName, lastName are required' 
//             })
//         };
//     }
    
//     // Validate email format
//     const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//     if (!emailRegex.test(userData.email)) {
//         return {
//             statusCode: 400,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'Invalid email format' })
//         };
//     }
    
//     const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
//     const timestamp = new Date().toISOString();
    
//     const user = {
//         userId,
//         email: userData.email.toLowerCase().trim(),
//         firstName: userData.firstName.trim(),
//         lastName: userData.lastName.trim(),
//         phone: userData.phone ? userData.phone.trim() : null,
//         country: userData.country ? userData.country.trim() : 'US',
//         createdAt: timestamp,
//         updatedAt: timestamp,
//         status: 'active'
//     };
    
//     try {
//         // Check if email already exists
//         const existingUser = await dynamodb.scan({
//             TableName: USERS_TABLE,
//             FilterExpression: 'email = :email',
//             ExpressionAttributeValues: {
//                 ':email': user.email
//             }
//         }).promise();
        
//         if (existingUser.Items && existingUser.Items.length > 0) {
//             return {
//                 statusCode: 409,
//                 headers: corsHeaders,
//                 body: JSON.stringify({ message: 'User with this email already exists' })
//             };
//         }
        
//         // Save to DynamoDB
//         await dynamodb.put({
//             TableName: USERS_TABLE,
//             Item: user,
//             ConditionExpression: 'attribute_not_exists(userId)'
//         }).promise();
        
//         // Publish event to EventBridge (if configured)
//         if (EVENT_BUS_NAME) {
//             await publishEvent('ecommerce.user', 'User Registered', {
//                 userId: user.userId,
//                 email: user.email,
//                 country: user.country,
//                 timestamp
//             });
//         }
        
//         return {
//             statusCode: 201,
//             headers: corsHeaders,
//             body: JSON.stringify({ user })
//         };
//     } catch (error) {
//         console.error('Error creating user:', error);
//         return {
//             statusCode: 500,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'Failed to create user', error: error.message })
//         };
//     }
// }

// async function getUser(userId) {
//     if (!userId) {
//         return {
//             statusCode: 400,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'User ID is required' })
//         };
//     }
    
//     try {
//         const result = await dynamodb.get({
//             TableName: USERS_TABLE,
//             Key: { userId }
//         }).promise();
        
//         if (!result.Item) {
//             return {
//                 statusCode: 404,
//                 headers: corsHeaders,
//                 body: JSON.stringify({ message: 'User not found' })
//             };
//         }
        
//         return {
//             statusCode: 200,
//             headers: corsHeaders,
//             body: JSON.stringify({ user: result.Item })
//         };
//     } catch (error) {
//         console.error('Error getting user:', error);
//         return {
//             statusCode: 500,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'Failed to get user', error: error.message })
//         };
//     }
// }

// async function getAllUsers() {
//     try {
//         const result = await dynamodb.scan({
//             TableName: USERS_TABLE
//         }).promise();
        
//         return {
//             statusCode: 200,
//             headers: corsHeaders,
//             body: JSON.stringify({ 
//                 users: result.Items,
//                 count: result.Items.length 
//             })
//         };
//     } catch (error) {
//         console.error('Error getting all users:', error);
//         return {
//             statusCode: 500,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'Failed to get users', error: error.message })
//         };
//     }
// }

// async function updateUser(userId, updateData) {
//     if (!userId) {
//         return {
//             statusCode: 400,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'User ID is required' })
//         };
//     }
    
//     // Remove fields that shouldn't be updated
//     const { userId: _, createdAt, ...allowedUpdates } = updateData;
    
//     if (Object.keys(allowedUpdates).length === 0) {
//         return {
//             statusCode: 400,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'No valid fields to update' })
//         };
//     }
    
//     // Validate email if provided
//     if (allowedUpdates.email) {
//         const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
//         if (!emailRegex.test(allowedUpdates.email)) {
//             return {
//                 statusCode: 400,
//                 headers: corsHeaders,
//                 body: JSON.stringify({ message: 'Invalid email format' })
//             };
//         }
//         allowedUpdates.email = allowedUpdates.email.toLowerCase().trim();
//     }
    
//     const timestamp = new Date().toISOString();
    
//     try {
//         // Check if user exists first
//         const existingUser = await dynamodb.get({
//             TableName: USERS_TABLE,
//             Key: { userId }
//         }).promise();
        
//         if (!existingUser.Item) {
//             return {
//                 statusCode: 404,
//                 headers: corsHeaders,
//                 body: JSON.stringify({ message: 'User not found' })
//             };
//         }
        
//         const params = {
//             TableName: USERS_TABLE,
//             Key: { userId },
//             UpdateExpression: 'SET updatedAt = :timestamp',
//             ExpressionAttributeValues: {
//                 ':timestamp': timestamp
//             },
//             ReturnValues: 'ALL_NEW'
//         };
        
//         // Build update expression dynamically
//         const updateFields = Object.keys(allowedUpdates);
//         if (updateFields.length > 0) {
//             updateFields.forEach(field => {
//                 params.UpdateExpression += `, ${field} = :${field}`;
//                 params.ExpressionAttributeValues[`:${field}`] = allowedUpdates[field];
//             });
//         }
        
//         const result = await dynamodb.update(params).promise();
        
//         return {
//             statusCode: 200,
//             headers: corsHeaders,
//             body: JSON.stringify({ user: result.Attributes })
//         };
//     } catch (error) {
//         console.error('Error updating user:', error);
//         return {
//             statusCode: 500,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'Failed to update user', error: error.message })
//         };
//     }
// }

// async function deleteUser(userId) {
//     if (!userId) {
//         return {
//             statusCode: 400,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'User ID is required' })
//         };
//     }
    
//     try {
//         // Check if user exists first
//         const existingUser = await dynamodb.get({
//             TableName: USERS_TABLE,
//             Key: { userId }
//         }).promise();
        
//         if (!existingUser.Item) {
//             return {
//                 statusCode: 404,
//                 headers: corsHeaders,
//                 body: JSON.stringify({ message: 'User not found' })
//             };
//         }
        
//         await dynamodb.delete({
//             TableName: USERS_TABLE,
//             Key: { userId }
//         }).promise();
        
//         return {
//             statusCode: 204,
//             headers: corsHeadersNoContent
//         };
//     } catch (error) {
//         console.error('Error deleting user:', error);
//         return {
//             statusCode: 500,
//             headers: corsHeaders,
//             body: JSON.stringify({ message: 'Failed to delete user', error: error.message })
//         };
//     }
// }

// async function publishEvent(source, detailType, detail) {
//     try {
//         const params = {
//             Entries: [{
//                 Source: source,
//                 DetailType: detailType,
//                 Detail: JSON.stringify(detail),
//                 EventBusName: EVENT_BUS_NAME
//             }]
//         };
        
//         await eventbridge.putEvents(params).promise();
//         console.log('Event published successfully:', detailType);
//     } catch (error) {
//         console.error('Failed to publish event:', error);
//         // Don't fail the main operation if event publishing fails
//     }
// }
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
    console.log('Event received:', JSON.stringify(event));
    
    try {
        const httpMethod = event.httpMethod || event.requestContext?.http?.method;
        
        if (httpMethod === 'GET') {
            // Get all users
            const result = await dynamodb.send(new ScanCommand({
                TableName: process.env.USERS_TABLE
            }));
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    users: result.Items || [],
                    count: result.Count || 0
                })
            };
        }
        
        if (httpMethod === 'POST') {
            // Create new user
            const body = JSON.parse(event.body || '{}');
            const userId = Date.now().toString();
            
            const user = {
                id: userId,
                ...body,
                createdAt: new Date().toISOString()
            };
            
            await dynamodb.send(new PutCommand({
                TableName: process.env.USERS_TABLE,
                Item: user
            }));
            
            return {
                statusCode: 201,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ user })
            };
        }
        
        return {
            statusCode: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
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
