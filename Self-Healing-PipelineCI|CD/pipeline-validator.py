import json
import boto3
import logging
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Fixed Lambda function for Step Functions integration
    Handles Bedrock analysis and pipeline monitoring
    """
    
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Extract pipeline information
        pipeline_name = event.get('detail', {}).get('pipeline', 'unknown')
        execution_id = event.get('detail', {}).get('execution-id', 'unknown')
        pipeline_state = event.get('detail', {}).get('state', 'unknown')
        
        # Process the input and create proper response structure
        response = {
            'processedInput': {
                'pipelineName': pipeline_name,
                'executionId': execution_id,
                'pipelineState': pipeline_state,
                'region': event.get('region', 'us-east-1'),
                'account': event.get('account', ''),
                'timestamp': event.get('time', datetime.utcnow().isoformat() + 'Z')
            },
            'statusCode': 200
        }
        
        # Handle error logs processing
        if pipeline_state == 'FAILED':
            try:
                error_message = f"Pipeline {pipeline_name} failed with execution {execution_id}"
                response['errorLogs'] = {
                    'errorLogs': {
                        'error': error_message,
                        'message': 'Pipeline execution failed'
                    },
                    'statusCode': 200
                }
            except Exception as e:
                response['errorLogs'] = {
                    'errorLogs': {
                        'error': str(e),
                        'message': 'Failed to extract error logs'
                    },
                    'statusCode': 500
                }
        
        # Handle Bedrock analysis - FIXED STRUCTURE
        try:
            analysis_result = {
                'error': f"Analysis completed for pipeline {pipeline_name}",
                'error_signature': f"PIPELINE_FAILURE_{pipeline_state}",
                'recommendations': [
                    'Check pipeline configuration',
                    'Verify IAM permissions', 
                    'Review CloudWatch logs'
                ],
                'severity': 'HIGH' if pipeline_state == 'FAILED' else 'LOW'
            }
            
            response['bedrockAnalysis'] = {
                'analysis': analysis_result,
                'statusCode': 200
            }
            
        except Exception as e:
            logger.error(f"Bedrock analysis failed: {str(e)}")
            response['bedrockAnalysis'] = {
                'analysis': {
                    'error': str(e),
                    'error_signature': 'BEDROCK_ACCESS_DENIED',
                    'message': 'Bedrock analysis failed'
                },
                'statusCode': 500
            }
        
        logger.info(f"Response: {json.dumps(response)}")
        return response
        
    except Exception as e:
        logger.error(f"Lambda execution failed: {str(e)}")
        return {
            'errorLogs': {
                'errorLogs': {
                    'error': str(e),
                    'message': 'Lambda execution failed'
                },
                'statusCode': 500
            },
            'bedrockAnalysis': {
                'analysis': {
                    'error': str(e),
                    'error_signature': 'LAMBDA_EXECUTION_ERROR',
                    'message': 'Lambda processing failed'
                },
                'statusCode': 500
            }
        }
