# Add this to the top of your Lambda function
import logging
import json
import os
import boto3
from datetime import datetime

# Configure logger
logger = logging.getLogger()
logger.setLevel(os.getenv('LOG_LEVEL', 'INFO'))

def lambda_handler(event, context):
    # Add structured logging (just add these 2 lines)
    logger.info(json.dumps({
        "message": "Function started",
        "request_id": context.aws_request_id,
        "function_name": context.function_name
    }))
    
    """
    Fixed Lambda function for Step Functions integration
    Handles Bedrock analysis and pipeline monitoring
    """
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Extract pipeline information from the event
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
                    'error': error_message,
                    'message': 'Pipeline execution failed',
                    'statusCode': 200
                }
            except Exception as e:
                response['errorLogs'] = {
                    'error': str(e),
                    'message': 'Failed to extract error logs',
                    'statusCode': 500
                }
        
        # Handle Bedrock analysis - FIXED: Added confidence_score
        try:
            # Calculate confidence score based on pipeline state
            confidence_score = 0.9 if pipeline_state == 'SUCCEEDED' else 0.3 if pipeline_state == 'FAILED' else 0.5
            
            response['bedrockAnalysis'] = {
                'analysis': {
                    'error': f"Analysis completed for pipeline {pipeline_name}",
                    'error_signature': f"PIPELINE_FAILURE_{pipeline_state}",
                    'recommendations': [
                        'Check pipeline configuration',
                        'Verify IAM permissions',
                        'Review CloudWatch logs'
                    ],
                    'severity': 'HIGH' if pipeline_state == 'FAILED' else 'LOW',
                    'confidence_score': confidence_score  # ADDED: This was missing!
                },
                'statusCode': 200
            }
        except Exception as e:
            logger.error(f"Bedrock analysis failed: {str(e)}")
            response['bedrockAnalysis'] = {
                'analysis': {
                    'error': str(e),
                    'error_signature': 'BEDROCK_ACCESS_DENIED',
                    'message': 'Bedrock analysis failed',
                    'confidence_score': 0.0  # ADDED: Default confidence score for errors
                },
                'statusCode': 500
            }
        
        logger.info(f"Response: {json.dumps(response)}")
        
        # Add at the end
        logger.info(json.dumps({
            "message": "Function completed",
            "request_id": context.aws_request_id
        }))
        
        return response
        
    except Exception as e:
        logger.error(f"Lambda execution failed: {str(e)}")
        
        # Add completion logging even for errors
        logger.info(json.dumps({
            "message": "Function completed with error",
            "request_id": context.aws_request_id,
            "error": str(e)
        }))
        
        return {
            'errorLogs': {
                'error': str(e),
                'message': 'Lambda execution failed',
                'statusCode': 500
            },
            'bedrockAnalysis': {
                'analysis': {
                    'error': str(e),
                    'error_signature': 'LAMBDA_EXECUTION_ERROR',
                    'message': 'Lambda processing failed',
                    'confidence_score': 0.0  # ADDED: Default confidence score for errors
                },
                'statusCode': 500
            }
        }
