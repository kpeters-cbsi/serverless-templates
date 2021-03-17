export default {
  handler: `${__dirname
    .split(process.cwd())[1]
    .substring(1)
    .replace(/\\/g, '/')}/handler.main`,
  events: [
    {
      http: {
        method: 'post',
        path: 'purge/all',
      },
    },
  ],
  iamRoleStatements: [
    {
      Effect: 'Allow',
      Action: ['sqs:SendMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'],
      Resource: { 'Fn::GetAtt': ['Queue', 'Arn'] },
    },
    {
      Effect: 'Allow',
      Action: 'ecs:ListTasks',
      Resource: '*',
    },
    {
      Effect: 'Allow',
      Action: 'ecs:DescribeTasks',
      Resource: {
        'Fn::Sub': 'arn:aws:ecs:*:${AWS::AccountId}:task/*',
      },
    },
  ],
  environment: {},
}
