export default {
  handler: `${__dirname
    .split(process.cwd())[1]
    .substring(1)
    .replace(/\\/g, '/')}/handler.main`,
  events: [
    {
      sqs: {
        arn: { 'Fn::GetAtt': ['Queue', 'Arn'] },
      },
    },
  ],
  environment: {
    JOB_STATUS_TABLE: { Ref: 'JobStatusTable' },
    JOB_LIFETIME_SECONDS: '${self:custom.jobLifetimeSeconds}',
    LOG_LEVEL: 'WARN',
  },
  iamRoleStatements: [
    {
      Effect: 'Allow',
      Action: ['dynamodb:BatchGetItem', 'dynamodb:PutItem'],
      Resource: { 'Fn::GetAtt': ['JobStatusTable', 'Arn'] },
    },
    {
      Effect: 'Allow',
      Action: ['sqs:DeleteMessage'],
      Resource: { 'Fn::GetAtt': ['Queue', 'Arn'] },
    },
  ],
  timeout: 120,
}
