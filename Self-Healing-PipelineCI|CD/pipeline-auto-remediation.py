import json
import boto3
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

codepipeline = boto3.client('codepipeline')
codebuild = boto3.client('codebuild')
sns = boto3.client('sns')

def lambda_handler(event, context):
    """
    Self-healing function for CodePipeline failures
    """
    try:
        # Parse CloudWatch alarm
        alarm_name = event['AlarmName']
        alarm_description = event['AlarmDescription']
        
        logger.info(f"Processing alarm: {alarm_name}")
        
        # Determine remediation action
        if 'Pipeline' in alarm_name:
            return handle_pipeline_failure(event)
        elif 'Build' in alarm_name:
            return handle_build_failure(event)
        else:
            return handle_generic_failure(event)
            
    except Exception as e:
        logger.error(f"Error in self-healing: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps(f'Self-healing failed: {str(e)}')
        }

def handle_pipeline_failure(event):
    """Handle pipeline failures"""
    pipeline_name = 'MyAppPipeline'
    
    try:
        # Get pipeline execution details
        response = codepipeline.list_pipeline_executions(
            pipelineName=pipeline_name,
            maxResults=1
        )
        
        if response['pipelineExecutionSummaries']:
            execution = response['pipelineExecutionSummaries'][0]
            
            if execution['status'] == 'Failed':
                # Retry the pipeline
                logger.info(f"Retrying failed pipeline: {pipeline_name}")
                codepipeline.start_pipeline_execution(name=pipeline_name)
                
                return {
                    'statusCode': 200,
                    'body': json.dumps(f'Pipeline {pipeline_name} restarted automatically')
                }
        
    except Exception as e:
        logger.error(f"Pipeline remediation failed: {str(e)}")
        raise

def handle_build_failure(event):
    """Handle build failures"""
    project_name = 'my-cdk-console-build'
    
    try:
        # Get recent build details
        response = codebuild.list_builds_for_project(
            projectName=project_name,
            sortOrder='DESCENDING'
        )
        
        if response['ids']:
            build_details = codebuild.batch_get_builds(ids=[response['ids'][0]])
            
            if build_details['builds']:
                build = build_details['builds'][0]
                
                if build['buildStatus'] == 'FAILED':
                    # Analyze failure and potentially restart
                    logger.info(f"Build failed: {build['id']}")
                    
                    # You can add logic here to restart the pipeline
                    # or perform other remediation actions
                    
                    return {
                        'statusCode': 200,
                        'body': json.dumps(f'Build failure handled for {project_name}')
                    }
        
    except Exception as e:
        logger.error(f"Build remediation failed: {str(e)}")
        raise

def handle_generic_failure(event):
    """Handle generic failure"""
    logger.info("Handling generic failure")
    
    # Send notification
    # Add your notification logic here
    
    return {
        'statusCode': 200,
        'body': json.dumps('Generic failure handled')
    }
