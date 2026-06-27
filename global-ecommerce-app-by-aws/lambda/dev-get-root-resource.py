import boto3
import cfnresponse
import json

def handler(event, context):
    try:
        if event['RequestType'] == 'Delete':
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            return
        
        client = boto3.client('apigateway')
        rest_api_id = event['ResourceProperties']['RestApiId']
        
        response = client.get_resources(restApiId=rest_api_id)
        
        root_resource = None
        for resource in response['items']:
            if resource['path'] == '/':
                root_resource = resource
                break
        
        if root_resource:
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                'RootResourceId': root_resource['id']
            })
        else:
            cfnresponse.send(event, context, cfnresponse.FAILED, {})
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {})
