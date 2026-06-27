// Use AWS SDK v3 for Node.js 18.x
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

// Initialize clients
const dynamodbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const eventbridge = new EventBridgeClient({ region: process.env.AWS_REGION });

const PAYMENTS_TABLE = process.env.PAYMENTS_TABLE;
const ORDERS_TABLE = process.env.ORDERS_TABLE;
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
    console.log('Payment Service Event:', JSON.stringify(event, null, 2));
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
                return await processPayment(JSON.parse(body));
                
            case 'GET':
                if (pathParameters && pathParameters.paymentId) {
                    return await getPayment(pathParameters.paymentId);
                }
                return await getPayments();
                
            case 'PUT':
                if (!pathParameters?.paymentId || !body) {
                    return createResponse(400, { error: 'Payment ID and body required' });
                }
                return await updatePaymentStatus(pathParameters.paymentId, JSON.parse(body));
                
            default:
                return createResponse(405, { error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('Payment Service Error:', error);
        return createResponse(500, { 
            error: 'Internal server error', 
            message: error.message 
        });
    }
};

async function processPayment(paymentData) {
    const paymentId = `pay-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    try {
        // Validate required fields
        if (!paymentData.orderId || !paymentData.userId || !paymentData.amount) {
            return createResponse(400, { 
                error: 'Missing required fields: orderId, userId, and amount' 
            });
        }
        
        // Validate amount
        if (paymentData.amount <= 0) {
            return createResponse(400, { error: 'Amount must be greater than 0' });
        }
        
        // Simulate payment processing logic (90% success rate)
        const paymentStatus = Math.random() > 0.1 ? 'completed' : 'failed';
        const failureReason = paymentStatus === 'failed' ? 'Insufficient funds' : null;
        
        const payment = {
            paymentId,
            orderId: paymentData.orderId,
            userId: paymentData.userId,
            amount: paymentData.amount,
            currency: paymentData.currency || 'USD',
            paymentMethod: paymentData.paymentMethod || 'credit_card',
            status: paymentStatus,
            transactionId: `txn-${Date.now()}`,
            failureReason,
            processingFee: Math.round(paymentData.amount * 0.029 * 100) / 100, // 2.9% fee
            netAmount: paymentData.amount - Math.round(paymentData.amount * 0.029 * 100) / 100,
            createdAt: timestamp,
            updatedAt: timestamp
        };
        
        // Save payment to DynamoDB
        await dynamodb.send(new PutCommand({
            TableName: PAYMENTS_TABLE,
            Item: payment
        }));
        
        // Update order status if payment successful
        if (paymentStatus === 'completed') {
            try {
                await dynamodb.send(new UpdateCommand({
                    TableName: ORDERS_TABLE,
                    Key: { orderId: paymentData.orderId },
                    UpdateExpression: 'SET #status = :status, updatedAt = :timestamp, paymentId = :paymentId',
                    ExpressionAttributeNames: { '#status': 'status' },
                    ExpressionAttributeValues: {
                        ':status': 'paid',
                        ':timestamp': timestamp,
                        ':paymentId': paymentId
                    }
                }));
            } catch (orderUpdateError) {
                console.error('Failed to update order status:', orderUpdateError);
                // Don't fail the payment if order update fails
            }
        }
        
        // Publish event
        await publishEvent('ecommerce.payment', 'Payment Processed', {
            paymentId: payment.paymentId,
            orderId: payment.orderId,
            userId: payment.userId,
            status: paymentStatus,
            amount: payment.amount,
            currency: payment.currency,
            paymentMethod: payment.paymentMethod,
            failureReason,
            timestamp
        });
        
        return createResponse(201, { 
            message: 'Payment processed successfully',
            payment 
        });
        
    } catch (error) {
        console.error('Process payment error:', error);
        return createResponse(500, { 
            error: 'Failed to process payment',
            message: error.message 
        });
    }
}

async function getPayment(paymentId) {
    try {
        const result = await dynamodb.send(new GetCommand({
            TableName: PAYMENTS_TABLE,
            Key: { paymentId }
        }));
        
        if (!result.Item) {
            return createResponse(404, { error: 'Payment not found' });
        }
        
        return createResponse(200, { payment: result.Item });
        
    } catch (error) {
        console.error('Get payment error:', error);
        return createResponse(500, { 
            error: 'Failed to get payment',
            message: error.message 
        });
    }
}

async function getPayments() {
    try {
        const result = await dynamodb.send(new ScanCommand({
            TableName: PAYMENTS_TABLE
        }));
        
        // Calculate summary statistics
        const payments = result.Items || [];
        const totalAmount = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
        const completedPayments = payments.filter(p => p.status === 'completed');
        const failedPayments = payments.filter(p => p.status === 'failed');
        
        return createResponse(200, { 
            payments,
            count: result.Count || 0,
            summary: {
                totalPayments: payments.length,
                completedPayments: completedPayments.length,
                failedPayments: failedPayments.length,
                totalAmount: totalAmount,
                successRate: payments.length > 0 ? ((completedPayments.length / payments.length) * 100).toFixed(2) + '%' : '0%'
            }
        });
        
    } catch (error) {
        console.error('Get payments error:', error);
        return createResponse(500, { 
            error: 'Failed to get payments',
            message: error.message 
        });
    }
}

async function updatePaymentStatus(paymentId, updateData) {
    const timestamp = new Date().toISOString();
    
    try {
        if (!updateData.status) {
            return createResponse(400, { error: 'Status is required' });
        }
        
        // Validate status
        const validStatuses = ['pending', 'completed', 'failed', 'refunded', 'cancelled'];
        if (!validStatuses.includes(updateData.status)) {
            return createResponse(400, { 
                error: 'Invalid status',
                validStatuses 
            });
        }
        
        const updateExpression = 'SET #status = :status, updatedAt = :timestamp';
        const expressionAttributeNames = { '#status': 'status' };
        const expressionAttributeValues = {
            ':status': updateData.status,
            ':timestamp': timestamp
        };
        
        // Add optional fields
        if (updateData.failureReason) {
            updateExpression += ', failureReason = :failureReason';
            expressionAttributeValues[':failureReason'] = updateData.failureReason;
        }
        
        if (updateData.refundAmount) {
            updateExpression += ', refundAmount = :refundAmount';
            expressionAttributeValues[':refundAmount'] = updateData.refundAmount;
        }
        
        const result = await dynamodb.send(new UpdateCommand({
            TableName: PAYMENTS_TABLE,
            Key: { paymentId },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        }));
        
        if (!result.Attributes) {
            return createResponse(404, { error: 'Payment not found' });
        }
        
        // Publish event for status change
        await publishEvent('ecommerce.payment', 'Payment Status Updated', {
            paymentId: result.Attributes.paymentId,
            orderId: result.Attributes.orderId,
            userId: result.Attributes.userId,
            oldStatus: 'unknown', // We don't have the old status
            newStatus: updateData.status,
            amount: result.Attributes.amount,
            timestamp
        });
        
        return createResponse(200, { 
            message: 'Payment status updated successfully',
            payment: result.Attributes 
        });
        
    } catch (error) {
        console.error('Update payment error:', error);
        return createResponse(500, { 
            error: 'Failed to update payment',
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
