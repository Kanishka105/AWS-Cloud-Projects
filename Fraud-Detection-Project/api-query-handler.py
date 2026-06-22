import json
import boto3
from datetime import datetime, timedelta
from decimal import Decimal
import os

# Initialize DynamoDB
dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('DYNAMODB_TABLE', 'fraud-detection-urgent-fraud-alerts')
table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    """Handle API requests for fraud detection data"""
    
    print(f"📥 API Request: {json.dumps(event, default=str)}")
    
    try:
        # Get the HTTP method and path
        http_method = event.get('httpMethod', 'GET')
        path = event.get('path', '')
        query_params = event.get('queryStringParameters') or {}
        
        print(f"🔍 Processing {http_method} {path}")
        
        # Route to appropriate handler
        if path == '/stats':
            response_data = get_real_time_stats()
        elif path == '/alerts':
            limit = int(query_params.get('limit', 50))
            response_data = get_alerts(limit)
        else:
            return create_response(404, {'error': 'Endpoint not found'})
        
        return create_response(200, response_data)
        
    except Exception as e:
        print(f"❌ Error processing request: {str(e)}")
        return create_response(500, {'error': 'Internal server error'})

def get_real_time_stats():
    """Calculate real-time statistics from DynamoDB"""
    try:
        print("📊 Calculating real-time statistics...")
        
        # Scan the entire table to get all alerts
        response = table.scan()
        items = response['Items']
        
        # Handle pagination if there are more items
        while 'LastEvaluatedKey' in response:
            response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
            items.extend(response['Items'])
        
        print(f"📋 Found {len(items)} total items in DynamoDB")
        
        # Calculate statistics
        total_transactions = len(items)
        fraud_alerts = 0
        high_risk_transactions = 0
        
        # Count alerts by severity and fraud score
        for item in items:
            fraud_score = int(item.get('fraud_score', 0))
            severity = item.get('severity', '').upper()
            status = item.get('status', '').upper()
            
            # Count active fraud alerts
            if status == 'ACTIVE' and severity in ['HIGH', 'CRITICAL']:
                fraud_alerts += 1
            
            # Count high-risk transactions (fraud score >= 70)
            if fraud_score >= 70:
                high_risk_transactions += 1
        
        # Calculate fraud rate
        fraud_rate = round((high_risk_transactions / total_transactions * 100), 1) if total_transactions > 0 else 0
        
        stats = {
            'total_transactions': total_transactions,
            'fraud_alerts': fraud_alerts,
            'high_risk_transactions': high_risk_transactions,
            'fraud_rate': fraud_rate,
            'last_updated': datetime.utcnow().isoformat()
        }
        
        print(f"📊 Calculated stats: {stats}")
        return stats
        
    except Exception as e:
        print(f"❌ Error calculating stats: {str(e)}")
        # Return default stats if error
        return {
            'total_transactions': 0,
            'fraud_alerts': 0,
            'high_risk_transactions': 0,
            'fraud_rate': 0,
            'last_updated': datetime.utcnow().isoformat(),
            'error': str(e)
        }

def get_alerts(limit=50):
    """Get recent fraud alerts from DynamoDB"""
    try:
        print(f"🚨 Fetching {limit} recent alerts...")
        
        # Scan table and sort by timestamp
        response = table.scan()
        items = response['Items']
        
        # Handle pagination
        while 'LastEvaluatedKey' in response:
            response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
            items.extend(response['Items'])
        
        # Sort by timestamp (newest first) and limit results
        sorted_items = sorted(items, key=lambda x: x.get('timestamp', 0), reverse=True)
        limited_items = sorted_items[:limit]
        
        # Convert Decimal types to regular numbers for JSON serialization
        alerts = []
        for item in limited_items:
            alert = {}
            for key, value in item.items():
                if isinstance(value, Decimal):
                    alert[key] = float(value)
                else:
                    alert[key] = value
            alerts.append(alert)
        
        print(f"🚨 Returning {len(alerts)} alerts")
        
        return {
            'alerts': alerts,
            'count': len(alerts),
            'total_in_db': len(items)
        }
        
    except Exception as e:
        print(f"❌ Error fetching alerts: {str(e)}")
        return {
            'alerts': [],
            'count': 0,
            'error': str(e)
        }

def create_response(status_code, body):
    """Create HTTP response with CORS headers"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token'
        },
        'body': json.dumps(body, default=str)
    }
