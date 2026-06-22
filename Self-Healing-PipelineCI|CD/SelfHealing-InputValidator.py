import json
import boto3
import logging
import os
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit

# Configure logger
logger = logging.getLogger()
logger.setLevel(os.getenv('LOG_LEVEL', 'INFO'))

# Initialize metrics outside handler for better performance
metrics = Metrics(namespace="PipelineMonitoring", service="ValidationService")

@metrics.log_metrics  # Automatically flush metrics at the end
def lambda_handler(event, context):
    # Start logging with structured format
    logger.info(json.dumps({
        "message": "Function started",
        "request_id": context.aws_request_id,
        "function_name": context.function_name,
        "event_source": event.get('source', 'unknown'),
        "timestamp": event.get('time')
    }))
    
    try:
        # Add metric for function invocation
        metrics.add_metric(name="FunctionInvocations", unit=MetricUnit.Count, value=1)
        
        # Validate CodePipeline event structure
        if 'detail' not in event:
            logger.error(json.dumps({
                "message": "Validation failed - Missing 'detail' in event",
                "request_id": context.aws_request_id,
                "error_type": "MissingDetailField",
                "event_keys": list(event.keys())
            }))
            metrics.add_metric(name="ValidationErrors", unit=MetricUnit.Count, value=1)
            raise ValueError("Missing 'detail' in event")
        
        detail = event['detail']
        required_fields = ['pipeline', 'execution-id', 'state']
        
        # Log the pipeline state for monitoring
        pipeline_state = detail.get('state', 'unknown')
        logger.info(json.dumps({
            "message": "Processing pipeline event",
            "request_id": context.aws_request_id,
            "pipeline_name": detail.get('pipeline', 'unknown'),
            "pipeline_state": pipeline_state,
            "execution_id": detail.get('execution-id', 'unknown')
        }))
        
        # Add metrics based on pipeline state
        if pipeline_state == 'SUCCEEDED':
            metrics.add_metric(name="PipelineSuccesses", unit=MetricUnit.Count, value=1)
        elif pipeline_state == 'FAILED':
            metrics.add_metric(name="PipelineFailures", unit=MetricUnit.Count, value=1)
        elif pipeline_state == 'STARTED':
            metrics.add_metric(name="PipelineStarts", unit=MetricUnit.Count, value=1)
        
        # Validate required fields
        for field in required_fields:
            if field not in detail:
                logger.error(json.dumps({
                    "message": f"Validation failed - Missing required field: {field}",
                    "request_id": context.aws_request_id,
                    "error_type": "MissingRequiredField",
                    "missing_field": field,
                    "available_fields": list(detail.keys())
                }))
                metrics.add_metric(name="ValidationErrors", unit=MetricUnit.Count, value=1)
                raise ValueError(f"Missing required field: {field}")
        
        # Extract and validate pipeline information
        processed_input = {
            'pipelineName': detail['pipeline'],
            'executionId': detail['execution-id'],
            'pipelineState': detail['state'],
            'region': event.get('region', 'us-east-1'),
            'account': event.get('account'),
            'timestamp': event.get('time')
        }
        
        # Log successful processing
        logger.info(json.dumps({
            "message": "Pipeline event processed successfully",
            "request_id": context.aws_request_id,
            "processed_data": processed_input,
            "processing_status": "success"
        }))
        
        # Add success metric
        metrics.add_metric(name="ProcessingSuccesses", unit=MetricUnit.Count, value=1)
        
        # Add processing time metric (optional)
        import time
        processing_time = int((time.time() * 1000) - (context.get_remaining_time_in_millis() or 0))
        metrics.add_metric(name="ProcessingDuration", unit=MetricUnit.Milliseconds, value=abs(processing_time))
        
        # Success completion log
        logger.info(json.dumps({
            "message": "Function completed successfully",
            "request_id": context.aws_request_id,
            "status_code": 200,
            "pipeline_name": processed_input['pipelineName'],
            "pipeline_state": processed_input['pipelineState']
        }))
        
        return {
            'statusCode': 200,
            'body': processed_input
        }
        
    except ValueError as ve:
        # Log validation errors with details
        logger.error(json.dumps({
            "message": "Validation error occurred",
            "request_id": context.aws_request_id,
            "error_type": "ValidationError",
            "error_details": str(ve),
            "function_name": context.function_name
        }))
        
        # Add error metrics
        metrics.add_metric(name="ValidationErrors", unit=MetricUnit.Count, value=1)
        metrics.add_metric(name="ProcessingFailures", unit=MetricUnit.Count, value=1)
        
        return {
            'statusCode': 400,
            'body': {
                'error': str(ve),
                'message': 'Input validation failed',
                'request_id': context.aws_request_id,
                'error_type': 'ValidationError'
            }
        }
        
    except Exception as e:
        # Log unexpected errors
        logger.error(json.dumps({
            "message": "Unexpected error occurred",
            "request_id": context.aws_request_id,
            "error_type": "UnexpectedError",
            "error_details": str(e),
            "function_name": context.function_name
        }))
        
        # Add error metrics
        metrics.add_metric(name="UnexpectedErrors", unit=MetricUnit.Count, value=1)
        metrics.add_metric(name="ProcessingFailures", unit=MetricUnit.Count, value=1)
        
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'message': 'Internal processing error',
                'request_id': context.aws_request_id,
                'error_type': 'UnexpectedError'
            }
        }
    
    finally:
        # Final log entry (always executed)
        logger.info(json.dumps({
            "message": "Function execution completed",
            "request_id": context.aws_request_id,
            "function_name": context.function_name
        }))
