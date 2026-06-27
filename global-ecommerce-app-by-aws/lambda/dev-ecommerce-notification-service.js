const AWS = require('aws-sdk');
const sns = new AWS.SNS();
const ses = new AWS.SES();

exports.handler = async (event) => {
    console.log('Notification Service Event:', JSON.stringify(event, null, 2));
    
    try {
        // Handle EventBridge events
        if (event.source) {
            return await handleEventBridgeEvent(event);
        }
        
        // Handle direct API calls
        const { httpMethod, body } = event;
        
        if (httpMethod === 'POST') {
            return await sendNotification(JSON.parse(body));
        }
        
        return {
            statusCode: 405,
            body: JSON.stringify({ message: 'Method not allowed' })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error', error: error.message })
        };
    }
};

async function handleEventBridgeEvent(event) {
    console.log('Processing EventBridge event:', event);
    
    const { source, 'detail-type': detailType, detail } = event;
    
    switch (source) {
        case 'ecommerce.user':
            if (detailType === 'User Registered') {
                await sendWelcomeEmail(detail);
            }
            break;
        case 'ecommerce.order':
            if (detailType === 'Order Created') {
                await sendOrderConfirmation(detail);
            } else if (detailType === 'Order Status Changed') {
                await sendOrderStatusUpdate(detail);
            }
            break;
        case 'ecommerce.payment':
            if (detailType === 'Payment Processed') {
                await sendPaymentNotification(detail);
            }
            break;
        case 'ecommerce.inventory':
            if (detailType === 'Inventory Updated') {
                await checkLowStockAlert(detail);
            }
            break;
    }
    
    return { statusCode: 200 };
}

async function sendNotification(notificationData) {
    const { type, recipient, message, subject } = notificationData;
    
    try {
        if (type === 'email') {
            await sendEmail(recipient, subject, message);
        } else if (type === 'sms') {
            await sendSMS(recipient, message);
        }
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ success: true, message: 'Notification sent' })
        };
    } catch (error) {
        console.error('Notification error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
}

async function sendWelcomeEmail(userDetail) {
    const subject = 'Welcome to Our E-commerce Platform!';
    const message = `
        Welcome ${userDetail.email}!
        
        Thank you for joining our e-commerce platform. We're excited to have you as a customer.
        
        Start exploring our products and enjoy shopping with us!
        
        Best regards,
        The E-commerce Team
    `;
    
    console.log(`Sending welcome email to: ${userDetail.email}`);
    // In production, implement actual email sending
}

async function sendOrderConfirmation(orderDetail) {
    const subject = `Order Confirmation - ${orderDetail.orderId}`;
    const message = `
        Your order has been confirmed!
        
        Order ID: ${orderDetail.orderId}
        Total: $${orderDetail.totalAmount}
        
        We'll send you updates as your order is processed.
        
        Thank you for your purchase!
    `;
    
    console.log(`Sending order confirmation for: ${orderDetail.orderId}`);
    // In production, implement actual email sending
}

async function sendOrderStatusUpdate(orderDetail) {
    console.log(`Order status update: ${orderDetail.orderId} - ${orderDetail.status}`);
    // In production, implement actual notification sending
}

async function sendPaymentNotification(paymentDetail) {
    console.log(`Payment notification: ${paymentDetail.paymentId} - ${paymentDetail.status}`);
    // In production, implement actual notification sending
}

async function checkLowStockAlert(inventoryDetail) {
    if (inventoryDetail.newQuantity < 5) {
        console.log(`LOW STOCK ALERT: Product ${inventoryDetail.productId} has only ${inventoryDetail.newQuantity} items left`);
        // In production, send alert to inventory managers
    }
}

async function sendEmail(recipient, subject, message) {
    // Placeholder for SES email sending
    console.log(`Email to ${recipient}: ${subject}`);
}

async function sendSMS(recipient, message) {
    // Placeholder for SNS SMS sending
    console.log(`SMS to ${recipient}: ${message}`);
}
