import json
import boto3
import base64
import logging
import os
from datetime import datetime, timedelta
from decimal import Decimal

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

# Get table names from environment variables
ALERTS_TABLE = os.environ.get('ALERTS_TABLE', 'fraud-detection-urgent-fraud-alerts')
RESULTS_TABLE = os.environ.get('RESULTS_TABLE', 'fraud-detection-results')

def lambda_handler(event, context):
    """Process Kinesis records for real-time fraud detection"""
    
    processed_records = 0
    alerts_created = 0
    errors = 0
    
    logger.info(f"Starting fraud detection processing")
    logger.info(f"Using tables: Alerts={ALERTS_TABLE}, Results={RESULTS_TABLE}")
    logger.info(f"Processing {len(event.get('Records', []))} records from Kinesis")
    
    try:
        alerts_table = dynamodb.Table(ALERTS_TABLE)
        results_table = dynamodb.Table(RESULTS_TABLE)
        
        for record in event.get('Records', []):
            try:
                # Decode Kinesis data
                payload = base64.b64decode(record['kinesis']['data']).decode('utf-8')
                transaction = json.loads(payload)
                
                logger.info(f"Processing transaction: {transaction.get('transaction_id', 'unknown')}")
                
                # Calculate fraud score
                fraud_score = calculate_fraud_score(transaction)
                
                # Store result in results table
                store_transaction_result(results_table, transaction, fraud_score)
                
                # Create alert if high risk
                if fraud_score > 0.7:  # High fraud probability threshold
                    create_fraud_alert(alerts_table, transaction, fraud_score)
                    alerts_created += 1
                    logger.warning(f"High fraud risk detected: {transaction.get('transaction_id')} - Score: {fraud_score}")
                
                processed_records += 1
                
            except Exception as e:
                logger.error(f"Error processing record: {str(e)}")
                errors += 1
                continue
        
        result = {
            'statusCode': 200,
            'body': json.dumps({
                'processed_records': processed_records,
                'alerts_created': alerts_created,
                'errors': errors,
                'timestamp': datetime.utcnow().isoformat()
            })
        }
        
        logger.info(f"Processing complete: processed={processed_records}, alerts={alerts_created}, errors={errors}")
        return result
        
    except Exception as e:
        logger.error(f"Critical error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def calculate_fraud_score(transaction):
    """Calculate fraud probability score based on transaction attributes"""
    score = 0.0
    
    try:
        # High amount transactions
        amount = float(transaction.get('amount', 0))
        if amount > 5000:
            score += 0.4
        elif amount > 2000:
            score += 0.2
        elif amount > 1000:
            score += 0.1
        
        # Known fraud flag from historical data
        if str(transaction.get('is_fraud', 0)) == '1':
            score += 0.5
        
        # Suspicious time patterns (late night transactions)
        try:
            if 'timestamp' in transaction:
                tx_time = datetime.fromisoformat(transaction['timestamp'].replace('Z', '+00:00'))
                hour = tx_time.hour
                if hour < 6 or hour > 23:  # Late night/early morning
                    score += 0.2
        except:
            pass
        
        # Suspicious merchant categories
        suspicious_categories = ['online', 'cash_advance', 'gambling']
        if transaction.get('category', '').lower() in suspicious_categories:
            score += 0.15
        
        # Round amounts (often fraudulent)
        if amount > 0 and amount % 100 == 0:
            score += 0.1
            
    except Exception as e:
        logger.error(f"Error calculating fraud score: {e}")
        score = 0.0
    
    return min(score, 1.0)  # Cap at 1.0

def store_transaction_result(results_table, transaction, fraud_score):
    """Store transaction processing result"""
    try:
        transaction_id = transaction.get('transaction_id', f"unknown_{int(datetime.utcnow().timestamp())}")
        
        result_item = {
            'transaction_id': transaction_id,
            'user_id': str(transaction.get('user_id', 'unknown')),
            'amount': Decimal(str(transaction.get('amount', 0))),
            'fraud_score': Decimal(str(fraud_score)),
            'merchant': str(transaction.get('merchant', 'unknown')),
            'category': str(transaction.get('category', 'unknown')),
            'timestamp': datetime.utcnow().isoformat(),
            'processed_at': datetime.utcnow().isoformat(),
            'is_fraud_predicted': 1 if fraud_score > 0.7 else 0,
            'ttl': int((datetime.utcnow() + timedelta(days=30)).timestamp())  # 30 days TTL
        }
        
        results_table.put_item(Item=result_item)
        logger.info(f"Stored result for transaction: {transaction_id}")
        
    except Exception as e:
        logger.error(f"Error storing transaction result: {e}")

def create_fraud_alert(alerts_table, transaction, fraud_score):
    """Create high-priority fraud alert"""
    try:
        transaction_id = transaction.get('transaction_id', f"unknown_{int(datetime.utcnow().timestamp())}")
        alert_id = f"alert_{transaction_id}_{int(datetime.utcnow().timestamp())}"
        current_time = datetime.utcnow()
        
        alert_item = {
            'alert_id': alert_id,
            'timestamp': int(current_time.timestamp()),  # Number for sort key
            'transaction_id': transaction_id,
            'user_id': str(transaction.get('user_id', 'unknown')),
            'amount': Decimal(str(transaction.get('amount', 0))),
            'fraud_score': Decimal(str(fraud_score)),
            'merchant': str(transaction.get('merchant', 'unknown')),
            'category': str(transaction.get('category', 'unknown')),
            'location': str(transaction.get('location', 'unknown')),
            'alert_type': 'HIGH_RISK',
            'status': 'PENDING',
            'created_at': current_time.isoformat(),
            'ttl': int((current_time + timedelta(days=30)).timestamp())  # 30 days TTL
        }
        
        alerts_table.put_item(Item=alert_item)
        logger.info(f"Created fraud alert: {alert_id}")
        
    except Exception as e:
        logger.error(f"Error creating fraud alert: {e}")
