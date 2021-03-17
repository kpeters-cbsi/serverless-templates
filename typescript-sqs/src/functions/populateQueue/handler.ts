import 'source-map-support/register'

import { formatJSONResponse } from '@libs/apiGateway'
import { middyfy } from '@libs/lambda'
import {
  SQS,
  SendMessageBatchCommand,
  BatchResultErrorEntry,
} from '@aws-sdk/client-sqs'
import { APIGatewayProxyHandler } from 'aws-lambda'
import { Message } from '@libs/message'
import { v4 as uuid } from 'uuid'
import Log from '@dazn/lambda-powertools-logger'
const QueueUrl = process.env.QUEUE_URL
const sqs = new SQS({})

const batchSize = 10

const populateQueue: APIGatewayProxyHandler = async () => {
  const messages: Message[] = []

  if (!QueueUrl) {
    throw new Error('No queue URL present in environment')
  }

  const promises = []
  // populate messages here

  const failed = (await Promise.allSettled(promises))
    .flat()
    .filter(({ status }) => status === 'rejected')
  if (failed.length) {
    Log.error(`${failed.length} commands could not be sent`, { failed })
    throw new Error(`${failed.length} commands could not be sent`)
  }

  return formatJSONResponse({ status: 'OK' })
}

const sendBatch = async (
  messages: Message[]
): Promise<BatchResultErrorEntry[] | void> => {
  Log.debug(`${messages.length} commands to send to queue ${QueueUrl}`)
  const Entries: Array<{ Id: string; MessageBody: string }> = []
  const lookup: Record<string, Message> = {}
  for (const message of messages) {
    const entry = {
      Id: uuid(),
      MessageBody: JSON.stringify(message),
    }
    lookup[entry.Id] = message
    Entries.push(entry)
  }

  const command = createSendMessageBatchCommand(messages)
  const res = await sqs.send(command)
  Log.debug('Commands sent', { command, Entries, res })
  if (res.Failed) {
    const failed = []
    Log.info(`${res.Failed.length} commands were not sent`)
    failed.push(...res.Failed.filter((entry) => entry.SenderFault))
    const retryIds = res.Failed.filter((entry) => !entry.SenderFault).map(
      (entry) => entry.Id
    )
    const retry = retryIds.map((id) => lookup[id])
    Log.info(
      `${retry.length}/${res.Failed.length} failed commands can be retried`
    )
    const failedAfterRetry = await sendBatch(retry)
    if (failedAfterRetry) {
      failed.push(...failedAfterRetry)
    }
    return failed
  }
}

const createSendMessageBatchCommand = (messages: Message[]) =>
  new SendMessageBatchCommand({
    QueueUrl,
    Entries: messages.map((message) => ({
      Id: uuid(),
      MessageBody: JSON.stringify(message),
    })),
  })

export const main = middyfy(populateQueue)
