import { FromSchema} from 'json-schema-to-ts'
export const messageSchema = {
  type: 'object',
  properties: {
    url: { 
      type: 'string', 
      format: 'uri'
    },
    serviceName: {
      type: 'string'
    }
  },
  required: ['url', 'serviceName'],
} as const

export type Message = FromSchema<typeof messageSchema>