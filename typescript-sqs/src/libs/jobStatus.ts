import { DynamoDB, PutItemCommandOutput } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import Log from '@dazn/lambda-powertools-logger'

export enum JobStatus {
  IN_PROGRESS, SUCCESS, FAILED
}

export interface JobStatusRecord {
  jobId: string
  status: JobStatus,
  statusReason?: string,
  expires?: number
}

const dynamoMaxItems = 100
const dynamodb = new DynamoDB({})
const TableName = process.env.JOB_STATUS_TABLE
const jobLifetimeSeconds = Number.parseInt(process.env.JOB_LIFETIME_SECONDS)

export const getJobStatus = async (jobId: string): Promise<JobStatusRecord> => {
  if (!TableName) {
    throw new Error('Job status table not set in execution environment')
  }
  if (!jobId) {
    throw new Error('a job ID is required')
  }

  const { Item } = await dynamodb.getItem({
    TableName,
    Key: marshall({
      jobId,
    }),
    ReturnConsumedCapacity: 'NONE',
  })
  return unmarshall(Item) as JobStatusRecord
}

export const getjobStatusBatch = async (
  jobIds: string[]
): Promise<{ [jobId: string]: JobStatus }> => {
  if (!TableName) {
    throw new Error('Job status table not set in execution environment')
  }
  const jobStatus: { [jobId: string]: JobStatus } = {}
  for (let i = 0; i < jobIds.length / dynamoMaxItems; i++) {
    const start = i * dynamoMaxItems
    const end = start + dynamoMaxItems
    const chunk = jobIds.slice(start, end)
    const params ={
      ReturnConsumedCapacity: 'NONE',
      RequestItems: {
        [TableName]: {
          Keys: chunk.map((jobId) => marshall({ jobId })),
        },
      },
    } 
    Log.debug(`Retrieving job status from Dynamo`, { params })
    const res = await dynamodb.batchGetItem(params)
    Log.debug(`Dynamo response`, { res })
    res.Responses[TableName].map((job) => unmarshall(job)).forEach((item) => {
      const jobId = item.jobId
      const status = item.jobStatus
      jobStatus[jobId] = status
    })
  }
  return jobStatus
}

export const setJobStatus = async ({
  jobId,
  status,
  statusReason,
  expires,
}: JobStatusRecord): Promise<PutItemCommandOutput> => {
  console.debug('CALL setJobStatus')
  if (!jobId) {
    throw new Error('a job ID is required')
  }
  if (typeof(status) === 'undefined') {
    throw new Error('a job status is required')
  }
  if (!TableName) {
    throw new Error('Job status table not set in execution environment')
  }
  if (!expires) {
    if (!jobLifetimeSeconds) {
      throw new Error('Job lifetime not set in execution environment')
    }
    expires = Math.floor(Date.now() / 1000) + jobLifetimeSeconds // note that Date.now() returns ms
  }

  console.debug(`Set job status to ${status} for job ${jobId}`)
  const res = await dynamodb.putItem({
    TableName,
    Item: marshall(
      { jobId, status, statusReason, expires },
      {
        removeUndefinedValues: true,
      }
    ),
  })
  return res
}
