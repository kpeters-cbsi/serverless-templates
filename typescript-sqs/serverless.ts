import type { AWS } from '@serverless/typescript'
import { populateQueue, queueConsumer } from './src/functions'

const stage = 'default'

const jobLifetimeSeconds = 600 // 10 minutes
interface VpcConfig {
  VpcId: string
  SubnetIds: string[]
}

const ec2 = new EC2({})

const getVpcConfig = async (
  vpcName: string,
  subnetName?: string
): Promise<VpcConfig> => {
  const vpcId = await getVpcId(vpcName)
  if (!vpcId) {
    throw new Error(`No VPC found with name "${vpcName}"`)
  }
  const subnetIds = await getVpcSubnetIds(vpcId, subnetName)
  return {
    VpcId: vpcId,
    SubnetIds: subnetIds,
  }
}

const getVpcId = async (vpcName: string): Promise<string> => {
  let NextToken: string
  let vpcId: string
  do {
    const res = await ec2.send(new DescribeVpcsCommand({ NextToken }))
    NextToken = res.NextToken
    const { VpcId } = res.Vpcs.filter(
      (vpc) =>
        vpc.Tags &&
        vpc.Tags.filter((tag) => tag.Key === 'Name' && tag.Value === vpcName)
          .length !== 0
    ).pop()
    vpcId = VpcId
    if (VpcId) break
  } while (!NextToken)

  return vpcId
}

const getVpcSubnetIds = async (
  vpcId: string,
  name?: string
): Promise<string[]> => {
  if (!vpcId) {
    throw new Error('No VPC ID passed')
  }
  const Filters = [
    {
      Name: 'vpc-id',
      Values: [vpcId],
    },
  ]

  if (name) {
    Filters.push({
      Name: 'tag:Name',
      Values: [name],
    })
  }
  let NextToken: string
  const subnetIds: string[] = []
  do {
    const res = await ec2.send(
      new DescribeSubnetsCommand({ Filters, NextToken })
    )
    NextToken = res.NextToken
    subnetIds.push(...res.Subnets.map((subnet) => subnet.SubnetId))
  } while (NextToken)
  return subnetIds
}

// This construction allows me to have my VPC lookup logic inside of serverless.ts rather
// than having it be in a separate file and referenced as "${file(somefile.js:promised)}"
module.exports = (async () => {
  const vpcConfig = await getVpcConfig(vpcName, `${vpcName}-private-*`)
  return {
    service: 'picks-purge-cache',
    frameworkVersion: '2',
    custom: {
      webpack: {
        webpackConfig: './webpack.config.js',
        includeModules: true,
      },
      jobLifetimeSeconds,
    },
    plugins: ['serverless-webpack', 'serverless-iam-roles-per-function'],
    provider: {
      name: 'aws',
      timeout: 29,
      runtime: 'nodejs14.x',
      stage,
      apiGateway: {
        minimumCompressionSize: 1024,
        shouldStartNameWithService: true,
      },
      logRetentionInDays: 30,
      endpointType: 'private',
      vpcEndpointIds: [{ Ref: 'VpcEndpoint' }],
      environment: {
        PATH: path,
        PORT: port.toString(),
        CLUSTER: cluster,
        QUEUE_URL: { Ref: 'Queue' },
      },
      lambdaHashingVersion: '20201221',
      vpc: {
        securityGroupIds: [{ 'Fn::GetAtt': ['VpcSecurityGroup', 'GroupId'] }],
        subnetIds: vpcConfig.SubnetIds,
      },
      resourcePolicy: [
        {
          Effect: 'Deny',
          Principal: '*',
          Action: 'execute-api:Invoke',
          Resource: 'excute-api:/*',
          Condition: {
            StringNotEquals: {
              'aws:SourceVpc': vpcConfig.VpcId,
            },
          },
        },
        {
          Effect: 'Allow',
          Principal: '*',
          Action: 'execute-api:Invoke',
          Resource: 'execute-api:/*',
        },
      ],
    },
    functions: { populateQueue, queueConsumer },
    resources: {
      Resources: {
        VpcEndpoint: {
          Type: 'AWS::EC2::VPCEndpoint',
          Properties: {
            ServiceName: {
              'Fn::Sub': 'com.amazonaws.${AWS::Region}.execute-api',
            },
            VpcId: vpcConfig.VpcId,
            SubnetIds: vpcConfig.SubnetIds,
            VpcEndpointType: 'Interface',
          },
        },
        VpcSecurityGroup: {
          Type: 'AWS::EC2::SecurityGroup',
          Properties: {
            VpcId: vpcConfig.VpcId,
            GroupDescription: 'Security Group for memory cache flush API',
          },
        },
        Queue: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            MessageRetentionPeriod: jobLifetimeSeconds / 2, // this might need adjusting
            RedrivePolicy: {
              deadLetterTargetArn: { 'Fn::GetAtt': [ 'DeadLetterQueue', 'Arn']},
              maxReceiveCount: 1
            }
          },
        },
        DeadLetterQueue: { 
          Type: 'AWS::SQS::Queue'
        },
        JobStatusTable: {
          Type: 'AWS::DynamoDB::Table',
          Properties: {
            AttributeDefinitions: [
              {
                AttributeName: 'jobId',
                AttributeType: 'S',
              },
            ],
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [
              {
                AttributeName: 'jobId',
                KeyType: 'HASH',
              },
            ],
            TimeToLiveSpecification: {
              AttributeName: 'expires',
              Enabled: true,
            },
          },
        },
      },
      Outputs: {
        BaseApiUrl: {
          Description: 'Base URL for API calls',
          Value: {
            'Fn::Sub':
              'https://${ApiGatewayRestApi}-${VpcEndpoint}.execute-api.${AWS::Region}.amazonaws.com/' +
              stage,
          },
        },
      },
    },
  } as AWS
})()
