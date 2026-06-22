import json
import boto3
import logging
import os
from datetime import datetime
from aws_lambda_powertools import Metrics
from aws_lambda_powertools.metrics import MetricUnit

# Configure logger
logger = logging.getLogger()
logger.setLevel(os.getenv('LOG_LEVEL', 'INFO'))

# Initialize metrics outside handler for better performance
metrics = Metrics(namespace="PipelineFixing", service="AutoFixService")

@metrics.log_metrics  # Automatically flush metrics at the end
def lambda_handler(event, context):
    # Add structured logging - Function started
    logger.info(json.dumps({
        "message": "Function started",
        "request_id": context.aws_request_id,
        "function_name": context.function_name,
        "timestamp": datetime.utcnow().isoformat(),
        "event_keys": list(event.keys()) if isinstance(event, dict) else []
    }))
    
    try:
        # Add metric for function invocation
        metrics.add_metric(name="FixAttempts", unit=MetricUnit.Count, value=1)
        
        # Extract and validate input parameters
        fix_action = event['fixAction']
        pipeline_name = event['pipelineName']
        execution_id = event['executionId']
        confidence_level = event['confidenceLevel']
        known_fix = event.get('knownFix')
        
        # Log the fix attempt details
        logger.info(json.dumps({
            "message": "Processing fix request",
            "request_id": context.aws_request_id,
            "pipeline_name": pipeline_name,
            "execution_id": execution_id,
            "fix_action": fix_action,
            "confidence_level": confidence_level,
            "known_fix": known_fix,
            "timestamp": datetime.utcnow().isoformat()
        }))
        
        # Add metrics based on fix action type
        if fix_action.startswith('retry_build'):
            metrics.add_metric(name="RetryBuildAttempts", unit=MetricUnit.Count, value=1)
        elif fix_action.startswith('update_dependency'):
            metrics.add_metric(name="DependencyUpdateAttempts", unit=MetricUnit.Count, value=1)
        elif fix_action.startswith('update_config'):
            metrics.add_metric(name="ConfigUpdateAttempts", unit=MetricUnit.Count, value=1)
        
        # Add confidence level metrics
        metrics.add_metric(name=f"ConfidenceLevel_{confidence_level.title()}", unit=MetricUnit.Count, value=1)
        
        codepipeline = boto3.client('codepipeline')
        
        fix_result = {
            'success': False,
            'fixApplied': False,
            'message': '',
            'actions_taken': []
        }
        
        if fix_action.startswith('retry_build'):
            # Simple retry - just return success to trigger pipeline restart
            logger.info(json.dumps({
                "message": "Executing retry build fix",
                "request_id": context.aws_request_id,
                "pipeline_name": pipeline_name,
                "fix_action": fix_action
            }))
            
            fix_result.update({
                'success': True,
                'fixApplied': True,
                'message': 'Pipeline will be retriggered',
                'actions_taken': ['scheduled_pipeline_retry']
            })
            
            # Add success metrics
            metrics.add_metric(name="RetryBuildSuccesses", unit=MetricUnit.Count, value=1)
            metrics.add_metric(name="FixesApplied", unit=MetricUnit.Count, value=1)
            
        elif fix_action.startswith('update_dependency'):
            # For dependency updates, you'd integrate with your build system
            logger.info(json.dumps({
                "message": "Processing dependency update",
                "request_id": context.aws_request_id,
                "pipeline_name": pipeline_name,
                "confidence_level": confidence_level,
                "fix_action": fix_action
            }))
            
            if confidence_level in ['high', 'known']:
                # Simulate dependency update
                logger.info(json.dumps({
                    "message": "Dependency update approved - high confidence",
                    "request_id": context.aws_request_id,
                    "pipeline_name": pipeline_name,
                    "confidence_level": confidence_level
                }))
                
                fix_result.update({
                    'success': True,
                    'fixApplied': True,
                    'message': 'Dependency update simulated',
                    'actions_taken': ['dependency_update_attempted']
                })
                
                metrics.add_metric(name="DependencyUpdateSuccesses", unit=MetricUnit.Count, value=1)
                metrics.add_metric(name="FixesApplied", unit=MetricUnit.Count, value=1)
            else:
                logger.warning(json.dumps({
                    "message": "Dependency update rejected - low confidence",
                    "request_id": context.aws_request_id,
                    "pipeline_name": pipeline_name,
                    "confidence_level": confidence_level,
                    "reason": "Confidence too low for automatic dependency update"
                }))
                
                fix_result.update({
                    'success': False,
                    'fixApplied': False,
                    'message': 'Confidence too low for automatic dependency update',
                    'actions_taken': []
                })
                
                metrics.add_metric(name="DependencyUpdateRejected", unit=MetricUnit.Count, value=1)
                metrics.add_metric(name="LowConfidenceRejections", unit=MetricUnit.Count, value=1)
                
        elif fix_action.startswith('update_config'):
            # Configuration updates
            logger.info(json.dumps({
                "message": "Processing configuration update",
                "request_id": context.aws_request_id,
                "pipeline_name": pipeline_name,
                "confidence_level": confidence_level,
                "fix_action": fix_action
            }))
            
            if confidence_level in ['high', 'known']:
                # Simulate config update
                logger.info(json.dumps({
                    "message": "Configuration update approved - high confidence",
                    "request_id": context.aws_request_id,
                    "pipeline_name": pipeline_name,
                    "confidence_level": confidence_level
                }))
                
                fix_result.update({
                    'success': True,
                    'fixApplied': True,
                    'message': 'Configuration update simulated',
                    'actions_taken': ['config_update_attempted']
                })
                
                metrics.add_metric(name="ConfigUpdateSuccesses", unit=MetricUnit.Count, value=1)
                metrics.add_metric(name="FixesApplied", unit=MetricUnit.Count, value=1)
            else:
                logger.warning(json.dumps({
                    "message": "Configuration update rejected - low confidence",
                    "request_id": context.aws_request_id,
                    "pipeline_name": pipeline_name,
                    "confidence_level": confidence_level,
                    "reason": "Confidence too low for automatic config update"
                }))
                
                fix_result.update({
                    'success': False,
                    'fixApplied': False,
                    'message': 'Confidence too low for automatic config update',
                    'actions_taken': []
                })
                
                metrics.add_metric(name="ConfigUpdateRejected", unit=MetricUnit.Count, value=1)
                metrics.add_metric(name="LowConfidenceRejections", unit=MetricUnit.Count, value=1)
                
        else:
            # Manual intervention required
            logger.warning(json.dumps({
                "message": "Manual intervention required",
                "request_id": context.aws_request_id,
                "pipeline_name": pipeline_name,
                "fix_action": fix_action,
                "reason": "Unknown or unsupported fix action"
            }))
            
            fix_result.update({
                'success': False,
                'fixApplied': False,
                'message': 'Manual intervention required',
                'actions_taken': ['escalated_to_manual']
            })
            
            metrics.add_metric(name="ManualInterventionRequired", unit=MetricUnit.Count, value=1)
            metrics.add_metric(name="UnsupportedFixActions", unit=MetricUnit.Count, value=1)
        
        # Log successful completion
        logger.info(json.dumps({
            "message": "Fix processing completed successfully",
            "request_id": context.aws_request_id,
            "pipeline_name": pipeline_name,
            "fix_result": fix_result,
            "processing_status": "success"
        }))
        
        # Add overall success metric
        if fix_result['success']:
            metrics.add_metric(name="OverallFixSuccesses", unit=MetricUnit.Count, value=1)
        else:
            metrics.add_metric(name="OverallFixFailures", unit=MetricUnit.Count, value=1)
        
        # Add structured logging - Function completed successfully
        logger.info(json.dumps({
            "message": "Function completed",
            "request_id": context.aws_request_id,
            "status_code": 200,
            "fix_applied": fix_result['fixApplied'],
            "pipeline_name": pipeline_name
        }))
        
        return {
            'statusCode': 200,
            'body': fix_result
        }
        
    except KeyError as ke:
        # Handle missing required parameters
        logger.error(json.dumps({
            "message": "Missing required parameter",
            "request_id": context.aws_request_id,
            "error_type": "MissingParameter",
            "missing_parameter": str(ke),
            "available_keys": list(event.keys()) if isinstance(event, dict) else [],
            "function_name": context.function_name
        }))
        
        metrics.add_metric(name="ParameterValidationErrors", unit=MetricUnit.Count, value=1)
        metrics.add_metric(name="ProcessingFailures", unit=MetricUnit.Count, value=1)
        
        return {
            'statusCode': 400,
            'body': {
                'error': f'Missing required parameter: {str(ke)}',
                'message': 'Parameter validation failed',
                'request_id': context.aws_request_id,
                'error_type': 'MissingParameter'
            }
        }
        
    except Exception as e:
        # Handle unexpected errors
        logger.error(json.dumps({
            "message": "Unexpected error occurred",
            "request_id": context.aws_request_id,
            "error_type": "UnexpectedError",
            "error_details": str(e),
            "function_name": context.function_name,
            "pipeline_name": event.get('pipelineName', 'unknown') if isinstance(event, dict) else 'unknown'
        }))
        
        metrics.add_metric(name="UnexpectedErrors", unit=MetricUnit.Count, value=1)
        metrics.add_metric(name="ProcessingFailures", unit=MetricUnit.Count, value=1)
        
        return {
            'statusCode': 500,
            'body': {
                'error': str(e),
                'message': 'Fix execution failed',
                'request_id': context.aws_request_id,
                'error_type': 'UnexpectedError'
            }
        }
    
    finally:
        # Final log entry (always executed)
        logger.info(json.dumps({
            "message": "Function execution completed",
            "request_id": context.aws_request_id,
            "function_name": context.function_name,
            "timestamp": datetime.utcnow().isoformat()
        }))
