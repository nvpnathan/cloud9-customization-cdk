import * as cloud9 from "@aws-cdk/aws-cloud9-alpha";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cr from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import * as path from "path";

const respondFunction = `
const respond = async function(event, context, responseStatus, responseData, physicalResourceId, noEcho) {
  return new Promise((resolve, reject) => {
    var responseBody = JSON.stringify({
        Status: responseStatus,
        Reason: "See the details in CloudWatch Log Stream: " + context.logGroupName + " " + context.logStreamName,
        PhysicalResourceId: physicalResourceId || context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        NoEcho: noEcho || false,
        Data: responseData
    });

    console.log("Response body:\\n", responseBody);

    var https = require("https");
    var url = require("url");

    var parsedUrl = url.parse(event.ResponseURL);
    var options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: "PUT",
        headers: {
            "content-type": "",
            "content-length": responseBody.length
        }
    };

    var request = https.request(options, function(response) {
        console.log("Status code: " + response.statusCode);
        console.log("Status message: " + response.statusMessage);
        resolve();
    });

    request.on("error", function(error) {
        console.log("respond(..) failed executing https.request(..): " + error);
        resolve();
    });

    request.write(responseBody);
    request.end();
  });
};
`;

export class Cloud9CustomizationCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const workspaceOwnerRoleArn = new cdk.CfnParameter(
      this,
      "WorkspaceOwnerRoleArn",
      {
        default: "RoleArnNotSet",
        type: "String",
      }
    );

    // const vpc = new ec2.Vpc(this, "VPC", {
    //   maxAzs: 2,
    //   ipAddresses: ec2.IpAddresses.cidr("10.23.0.0/16"),
    //   natGateways: 1,
    //   subnetConfiguration: [
    //     {
    //       subnetType: ec2.SubnetType.PUBLIC,
    //       name: "Public",
    //       cidrMask: 18,
    //     },
    //     {
    //       subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    //       name: "Private",
    //       cidrMask: 18,
    //     },
    //   ],
    // });

    const vpc = ec2.Vpc.fromLookup(this, "DefaultVPC", { isDefault: true });

    const instanceRole = new iam.Role(this, "WorkspaceInstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
      ],
      description: "Workspace EC2 instance role",
    });
    instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    new cdk.CfnOutput(this, "WorkspaceInstanceRoleName", {
      value: instanceRole.roleName,
    });

    const instanceProfile = new iam.CfnInstanceProfile(
      this,
      "WorkspaceInstanceProfile",
      {
        roles: [instanceRole.roleName],
      }
    );

    const workspace = new cloud9.Ec2Environment(this, "Workspace", {
      imageId: cloud9.ImageId.AMAZON_LINUX_2,
      vpc: vpc,
      ec2EnvironmentName: "serverless-first-workshop",
      description: "Serverless First Workshop",
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM
      ),
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const workspaceInstance = new cr.AwsCustomResource(
      this,
      "WorkspaceInstance",
      {
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        onUpdate: {
          service: "EC2",
          action: "describeInstances",
          physicalResourceId: cr.PhysicalResourceId.of(workspace.environmentId),
          parameters: {
            Filters: [
              {
                Name: "tag:aws:cloud9:environment",
                Values: [workspace.environmentId],
              },
            ],
          },
          outputPaths: [
            "Reservations.0.Instances.0.InstanceId",
            "Reservations.0.Instances.0.NetworkInterfaces.0.Groups.0.GroupId",
          ],
        },
      }
    );
    const instanceId = workspaceInstance.getResponseField(
      "Reservations.0.Instances.0.InstanceId"
    );

    const workspaceSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "WorkspaceSecurityGroup",
      workspaceInstance.getResponseField(
        "Reservations.0.Instances.0.NetworkInterfaces.0.Groups.0.GroupId"
      )
    );

    //     const updateInstanceProfileFunction = new lambda.Function(
    //       this,
    //       "UpdateInstanceProfileFunction",
    //       {
    //         code: lambda.Code.fromInline(
    //           `
    // import { EC2 } from "aws-sdk";

    // export async function onEventHandler(event: any): Promise<any> {
    //   console.log(JSON.stringify(event, null, 4));

    //   const ec2 = new EC2();

    //   if (event.RequestType === "Create") {
    //     const { IamInstanceProfileAssociations } = await ec2
    //       .describeIamInstanceProfileAssociations({
    //         Filters: [
    //           {
    //             Name: "instance-id",
    //             Values: [event.ResourceProperties["InstanceId"]],
    //           },
    //         ],
    //       })
    //       .promise();

    //     console.log(JSON.stringify(IamInstanceProfileAssociations, null, 4));

    //     if (IamInstanceProfileAssociations?.length == 1) {
    //       const associationId = IamInstanceProfileAssociations[0].AssociationId;
    //       if (associationId) {
    //         await ec2
    //           .replaceIamInstanceProfileAssociation({
    //             IamInstanceProfile: {
    //               Arn: event.ResourceProperties.InstanceProfileArn,
    //             },
    //             AssociationId: associationId,
    //           })
    //           .promise();
    //       }
    //     } else {
    //       await ec2
    //         .associateIamInstanceProfile({
    //           IamInstanceProfile: {
    //             Arn: event.ResourceProperties.InstanceProfileArn,
    //           },
    //           InstanceId: event.ResourceProperties.InstanceId,
    //         })
    //         .promise();
    //     }
    //   }
    //   return {
    //     PhysicalResourceId: "",
    //   };
    // }
    //           `
    //         ),
    //         handler: "index.onEventHandler",
    //         runtime: lambda.Runtime.NODEJS_14_X,
    //       }
    //     );

    const updateInstanceProfileFunction = new lambda.Function(
      this,
      "UpdateInstanceProfileFunction",
      {
        code: lambda.Code.fromAsset(
          path.join(__dirname, "update-instance-profile")
        ),
        handler: "index.onEventHandler",
        runtime: lambda.Runtime.NODEJS_14_X,
      }
    );

    updateInstanceProfileFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ec2:DescribeIamInstanceProfileAssociations",
          "ec2:ReplaceIamInstanceProfileAssociation",
          "ec2:AssociateIamInstanceProfile",
          "iam:PassRole",
        ],
        resources: ["*"], // TODO: use specific instance ARN
      })
    );

    const updateInstanceProfile = new cr.Provider(
      this,
      "UpdateInstanceProfileProvider",
      {
        onEventHandler: updateInstanceProfileFunction,
      }
    );

    const updateWorkspaceInstanceProfileCustomResource = new cdk.CustomResource(
      this,
      "UpdateInstanceProfile",
      {
        serviceToken: updateInstanceProfile.serviceToken,
        properties: {
          InstanceId: instanceId,
          InstanceProfileArn: instanceProfile.attrArn,
        },
      }
    );

    const updateWorkspaceMembershipFunction = new lambda.Function(
      this,
      "UpdateWorkspaceMembershipFunction",
      {
        code: lambda.Code.fromInline(
          respondFunction +
            `
exports.handler = async function (event, context) {
  console.log(JSON.stringify(event, null, 4));
  const AWS = require('aws-sdk');

  try {
    const environmentId = event.ResourceProperties.EnvironmentId;

    if (event.RequestType === "Create" || event.RequestType === "Update") {
      const workspaceOwnerRoleArn = event.ResourceProperties.WorkspaceOwnerRoleArn;

      if (!!workspaceOwnerRoleArn && workspaceOwnerRoleArn !== 'RoleArnNotSet') {
        console.log('Resolved workspace owner role ARN: ' + workspaceOwnerRoleArn);

        const cloud9 = new AWS.Cloud9();

        const { membership } = await cloud9.createEnvironmentMembership({
            environmentId,
            permissions: 'read-write',
            userArn: workspaceOwnerRoleArn,
        }).promise();
        console.log(JSON.stringify(membership, null, 4));
      }
    }
    console.log('--------------------------------------------------- Waiting');
    await new Promise(resolve => setTimeout(resolve, 400000));
    console.log('Sending SUCCESS response');
    await respond(event, context, 'SUCCESS', {}, environmentId);
  } catch (error) {
      console.error(error);
      await respond(event, context, 'FAILED', { Error: error });
  }
};
          `
        ),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_14_X,
        timeout: cdk.Duration.minutes(12),
      }
    );
    updateWorkspaceMembershipFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloud9:createEnvironmentMembership"],
        resources: ["*"],
      })
    );

    const updateWorkspaceMembershipResource = new cdk.CustomResource(
      this,
      "UpdateWorkspaceMembership",
      {
        serviceToken: updateWorkspaceMembershipFunction.functionArn,
        properties: {
          EnvironmentId: workspace.environmentId,
          WorkspaceOwnerRoleArn: workspaceOwnerRoleArn.valueAsString,
        },
      }
    );

    const runCommandRole = new iam.Role(this, "RunCommandRole", {
      assumedBy: new iam.ServicePrincipal("ssm.amazonaws.com"),
    });
    const runCommandLogGroup = new logs.LogGroup(this, "RunCommandLogs");
    runCommandLogGroup.grantWrite(runCommandRole);

    const instancePrepCustomResource = new cr.AwsCustomResource(
      this,
      "InstancePrep",
      {
        installLatestAwsSdk: false,
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [runCommandRole.roleArn],
          }),
          new iam.PolicyStatement({
            actions: ["ssm:SendCommand"],
            resources: ["*"],
          }),
        ]),
        onUpdate: {
          service: "SSM",
          action: "sendCommand",
          physicalResourceId: cr.PhysicalResourceId.of(workspace.environmentId),
          parameters: {
            DocumentName: "AWS-RunShellScript",
            DocumentVersion: "$LATEST",
            InstanceIds: [instanceId],
            TimeoutSeconds: 60,
            ServiceRoleArn: runCommandRole.roleArn,
            CloudWatchOutputConfig: {
              CloudWatchLogGroupName: runCommandLogGroup.logGroupName,
              CloudWatchOutputEnabled: true,
            },
            Parameters: {
              commands: [
                "yum -y install jq gettext moreutils",
                'sudo curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"',
                "sudo unzip -d /tmp /tmp/awscliv2.zip",
                "sudo /tmp/aws/install",
              ],
            },
          },
          outputPaths: ["CommandId"],
        },
      }
    );

    instancePrepCustomResource.node.addDependency(workspace);
    instancePrepCustomResource.node.addDependency(
      updateWorkspaceMembershipResource
    );
    instancePrepCustomResource.node.addDependency(workspaceInstance);
    instancePrepCustomResource.node.addDependency(
      updateWorkspaceInstanceProfileCustomResource
    );

    new cdk.CfnOutput(this, "URL", { value: workspace.ideUrl });
  }
}
