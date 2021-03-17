import middy from '@middy/core'
import middyJsonBodyParser from '@middy/http-json-body-parser'
import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda'

export const middyfy = (
  handler: APIGatewayProxyHandler
): middy.Middy<APIGatewayProxyEvent, APIGatewayProxyResult, Context> =>
  middy(handler).use(middyJsonBodyParser())
