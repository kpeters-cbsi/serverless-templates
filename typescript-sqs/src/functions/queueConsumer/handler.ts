import 'source-map-support/register'
import middy from '@middy/core'
import sqsJsonBodyParser from '@middy/sqs-json-body-parser'
import { Message, messageSchema } from '@libs/message'
import { ValidatedEventSQSEvent } from '@libs/sqs'
import got, { Response } from 'got'
import { SQSRecord } from 'aws-lambda'
import { getjobStatusBatch, JobStatus, setJobStatus } from '@libs/jobStatus'
import { SQS, DeleteMessageBatchCommand } from '@aws-sdk/client-sqs'
import { v4 as uuid } from 'uuid'

const QueueUrl = process.env.QUEUE_URL
const sqsBatchSize = 10
const sqs = new SQS({})
const queueConsumer: ValidatedEventSQSEvent<typeof messageSchema> = async (
  event
) => {
  if (!QueueUrl) {
    throw new Error('No queue URL present in environment')
  } else {
    console.debug(`Queue URL: ${QueueUrl}`)
  }
  const recordsToProcess = await getRecordsToProcess(event.Records)
  console.debug(`${recordsToProcess.length} records to process`)

  await Promise.all(recordsToProcess.map(async (record) => {
  const jobId = record.messageId
  try {
    await setJobStatus({ jobId, status: JobStatus.IN_PROGRESS })
  } catch (e) {
    console.error(`Caught exception in setJobStatus: `, { error: e })
    throw e
  }
    let res
    try {
      res = await processRecord(record.body as unknown as Message, jobId)
    } catch (e) {
      await setJobStatus({ jobId, status: JobStatus.FAILED, statusReason: e })
    }
    return res
  }))

  for (let i = 0; i < recordsToProcess.length / sqsBatchSize; i++) {
    const Entries = recordsToProcess
      .slice(i * sqsBatchSize, i * sqsBatchSize + sqsBatchSize)
      .map((record) => ({ Id: uuid(), ReceiptHandle: record.receiptHandle }))
    await sqs.send(
      new DeleteMessageBatchCommand({
        QueueUrl,
        Entries,
      })
    )
  }
}

// JOB PROCESSING LOGIC GOES HERE
const processRecord = async (message: Message, jobId: string) => {
  console.debug({ message })
  const { url, serviceName } = message
  console.debug(`Processing job ${jobId}:`, { url, serviceName })
  // job processing logic goes here
}

const getRecordsToProcess = async (
  records: SQSRecord[]
): Promise<SQSRecord[]> => {
  console.debug(`${records.length} records to examine`)
  const jobIds = records.map((record) => record.messageId)
  const jobStatus = await getjobStatusBatch(jobIds)
  console.debug(`Job status`, { jobStatus, jobIds })
  const toProcess = records.filter((record) => {
    const jobId = record.messageId
    let process = true
    switch (jobStatus[jobId]) {
      case JobStatus.FAILED:
        console.info(`Job ID ${jobId} failed, retrying`)
        break
      case JobStatus.SUCCESS:
        console.info(`Job ID ${jobId} already processed.`)
        process = false
        break
      case JobStatus.IN_PROGRESS:
        console.info(`Job ID ${jobId} is being processed by another thread.`)
        process = false
        break
      default:
        console.info(`Job ID ${jobId} not yet processed.`)
        break
    }
    return process
  })
  return toProcess
}

export const main = middy(queueConsumer).use(sqsJsonBodyParser())
