# Add this to the top of your Lambda function
import logging
import json
import os
import boto3
from datetime import datetime, timedelta

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
    
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        pipeline_name = event['pipelineName']
        execution_id = event['executionId']
        region = event.get('region', 'us-east-1')
        
        logger.info(json.dumps({
            "message": "Processing pipeline",
            "pipeline_name": pipeline_name,
            "execution_id": execution_id,
            "region": region,
            "request_id": context.aws_request_id
        }))
        
        codepipeline = boto3.client('codepipeline', region_name=region)
        logs_client = boto3.client('logs', region_name=region)
        
        # Get pipeline execution details
        execution = codepipeline.get_pipeline_execution(
            pipelineName=pipeline_name,
            pipelineExecutionId=execution_id
        )
        
        # Get failed actions
        action_executions = codepipeline.list_action_executions(
            pipelineName=pipeline_name,
            filter={
                'pipelineExecutionId': execution_id
            }
        )
        
        error_logs = []
        
        for action in action_executions['actionExecutionDetails']:
            if action['status'] == 'Failed':
                logger.info(json.dumps({
                    "message": "Processing failed action",
                    "action_name": action['actionName'],
                    "stage_name": action['stageName'],
                    "request_id": context.aws_request_id
                }))
                
                # Extract error information
                error_info = {
                    'actionName': action['actionName'],
                    'stageName': action['stageName'],
                    'errorMessage': action.get('output', {}).get('executionResult', {}).get('externalExecutionSummary', ''),
                    'errorCode': action.get('output', {}).get('executionResult', {}).get('externalExecutionId', ''),
                    'timestamp': action.get('lastUpdateTime', '').isoformat() if action.get('lastUpdateTime') else ''
                }
                
                # Try to get CloudWatch logs if available
                if 'CodeBuild' in action.get('actionTypeId', {}).get('provider', ''):
                    try:
                        logger.info(json.dumps({
                            "message": "Extracting CodeBuild logs",
                            "action_name": action['actionName'],
                            "request_id": context.aws_request_id
                        }))
                        
                        # Get CodeBuild logs
                        codebuild = boto3.client('codebuild', region_name=region)
                        build_id = action.get('output', {}).get('executionResult', {}).get('externalExecutionId', '')
                        
                        if build_id:
                            build_details = codebuild.batch_get_builds(ids=[build_id])
                            if build_details['builds']:
                                build = build_details['builds'][0]
                                log_group = build.get('logs', {}).get('groupName', '')
                                log_stream = build.get('logs', {}).get('streamName', '')
                                
                                if log_group and log_stream:
                                    log_events = logs_client.get_log_events(
                                        logGroupName=log_group,
                                        logStreamName=log_stream,
                                        limit=100
                                    )
                                    
                                    error_info['detailedLogs'] = [
                                        event['message'] for event in log_events['events']
                                        if 'error' in event['message'].lower() or 'fail' in event['message'].lower()
                                    ]
                                    
                                    logger.info(json.dumps({
                                        "message": "Successfully extracted detailed logs",
                                        "log_count": len(error_info['detailedLogs']),
                                        "request_id": context.aws_request_id
                                    }))
                    except Exception as log_error:
                        logger.error(json.dumps({
                            "message": "Failed to extract CodeBuild logs",
                            "error": str(log_error),
                            "action_name": action['actionName'],
                            "request_id": context.aws_request_id
                        }))
                        error_info['logExtractionError'] = str(log_error)
                
                error_logs.append(error_info)
        
        response = {
            'statusCode': 200,
            'body': {
                'pipelineName': pipeline_name,
                'executionId': execution_id,
                'errorLogs': error_logs,
                'extractedAt': datetime.utcnow().isoformat()
            }
        }
        
        logger.info(json.dumps({
            "message": "Successfully processed pipeline",
            "error_count": len(error_logs),
            "request_id": context.aws_request_id
        }))
        
        # Add at the end
        logger.info(json.dumps({
            "message": "Function completed",
            "request_id": context.aws_request_id
        }))
        
        return response
        
    except Exception as e:
        logger.error(json.dumps({
            "message": "Lambda execution failed",
            "error": str(e),
            "request_id": context.aws_request_id
        }))
        
        # Add completion logging even for errors
        logger.info(json.dumps({
            "message": "Function completed with error",
            "request_id": context.aws_request_id,
            "error": str(e)
        }))
        
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'message': 'Failed to extract error logs'
            }
        }
