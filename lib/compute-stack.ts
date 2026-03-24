import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * Compute stack: Lambda + Security Group.
 * Depends on netlumi-cdk-foundation and netlumi-cdk-iam-access via SSM params.
 *
 * Intentional misconfigs for detection testing:
 *   - Lambda: no VPC, no X-Ray tracing, no dead-letter queue, public URL enabled
 *   - Security Group: ingress 0.0.0.0/0 on SSH port 22 and RDP 3389
 *   - CloudWatch log group: no retention policy (infinite retention)
 *   - Lambda uses overly broad role from iam-access repo
 */
export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Read cross-repo dependencies from SSM (foundation + iam-access)
    const appRoleArn = ssm.StringParameter.valueForStringParameter(
      this, '/netlumi/e2e/iam/app-role-arn'
    );
    const foundationBucketName = ssm.StringParameter.valueForStringParameter(
      this, '/netlumi/e2e/foundation/bucket-name'
    );
    const queueUrl = ssm.StringParameter.valueForStringParameter(
      this, '/netlumi/e2e/iam/queue-url'
    );

    // Import existing IAM role from iam-access stack
    const appRole = iam.Role.fromRoleArn(this, 'ImportedAppRole', appRoleArn);

    // Security Group — open SSH and RDP to the world (detection: unrestricted ssh, rdp)
    // NOTE: uses default VPC for simplicity (no NAT gateway cost)
    const defaultVpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    const webSg = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
      vpc: defaultVpc,
      securityGroupName: 'netlumi-e2e-web-sg',
      description: 'Netlumi E2E test security group',
      allowAllOutbound: true,  // MISCONFIGURED: should restrict outbound
    });

    // MISCONFIGURED: SSH open to world (detection: unrestricted ssh access)
    webSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'MISCONFIGURED: SSH open to world'
    );

    // MISCONFIGURED: RDP open to world (detection: unrestricted rdp access)
    webSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3389),
      'MISCONFIGURED: RDP open to world'
    );

    // MISCONFIGURED: HTTP open to world
    webSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP open to all'
    );

    // CloudWatch log group — no retention (detection: log group no retention)
    const logGroup = new logs.LogGroup(this, 'ProcessorLogs', {
      logGroupName: '/netlumi/e2e/processor',
      retention: logs.RetentionDays.INFINITE,  // MISCONFIGURED: should have retention
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda — no VPC, no X-Ray, no DLQ, env var with secret-like name
    const processorFn = new lambda.Function(this, 'ProcessorFunction', {
      functionName: 'netlumi-e2e-processor',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      // MISCONFIGURED: inline code is fine for test, but no VPC means public internet
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Processing event:', JSON.stringify(event));
          return { statusCode: 200, body: 'ok' };
        };
      `),
      role: appRole,
      // MISCONFIGURED: no vpc — Lambda runs outside VPC (detection: lambda no vpc)
      // MISCONFIGURED: no tracing — X-Ray disabled (detection: lambda tracing disabled)
      tracing: lambda.Tracing.DISABLED,
      // MISCONFIGURED: no dead letter queue
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      logGroup: logGroup,
      environment: {
        BUCKET_NAME: foundationBucketName,
        QUEUE_URL: queueUrl,
        // MISCONFIGURED: secret-looking env var name (detection: lambda secret in env)
        API_SECRET_KEY: 'placeholder-should-use-secrets-manager',
      },
    });

    // Lambda function URL — no auth (detection: lambda public url no auth)
    processorFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,  // MISCONFIGURED: public, no auth
      cors: {
        allowedOrigins: ['*'],  // MISCONFIGURED: open CORS
        allowedMethods: [lambda.HttpMethod.ALL],
      },
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', { value: processorFn.functionName });
    new cdk.CfnOutput(this, 'SecurityGroupId', { value: webSg.securityGroupId });
  }
}
