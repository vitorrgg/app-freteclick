// read configured E-Com Plus app data
const getAppData = require('./../../lib/store-api/get-app-data')
const createTag = require('../../lib/freteclick/create-tag')

const SKIP_TRIGGER_NAME = 'SkipTrigger'
const ECHO_SUCCESS = 'SUCCESS'
const ECHO_SKIP = 'SKIP'
const ECHO_API_ERROR = 'STORE_API_ERR'

exports.post = ({ appSdk }, req, res) => {
  // receiving notification from Store API
  const { storeId } = req

  /**
   * Treat E-Com Plus trigger body here
   * Ref.: https://developers.e-com.plus/docs/api/#/store/triggers/
   */
  const trigger = req.body

  // get app configured options
  let auth
  appSdk.getAuth(storeId).then(_auth => {
    auth = _auth
    return getAppData({ appSdk, storeId, auth })

    .then(appData => {
      if (
        Array.isArray(appData.ignore_triggers) &&
        appData.ignore_triggers.indexOf(trigger.resource) > -1
      ) {
        // ignore current trigger
        const err = new Error()
        err.name = SKIP_TRIGGER_NAME
        throw err
      }

      /* DO YOUR CUSTOM STUFF HERE */
      const { api_key, send_tag_status } = appData
      if (send_tag_status && api_key && trigger.resource === 'orders') {
        // handle order financial status changes
        const order = trigger.body
        if (
          order &&
          order.financial_status &&
          (order.financial_status.current === 'paid')
        ) {
          // read full order body
          const resourceId = trigger.resource_id
          console.log('Trigger disparado para enviar tag com id:', resourceId)
          return appSdk.apiRequest(storeId, `/orders/${resourceId}.json`, 'GET', null, auth)
            .then(({ response }) => {
              const order = response.data
              if (order && order.shipping_lines[0] && order.shipping_lines[0].flags && order.shipping_lines[0].flags.length && order.shipping_lines[0].flags.indexOf('freteclick-ws') === -1) {
                return res.send(ECHO_SKIP)
              }
              console.log(`Shipping tag for #${storeId} ${order._id}`)
              return createTag(order, api_key, storeId, appData, appSdk)
                .then(data => {
                  console.log(`>> Etiqueta Criada Com Sucesso #${storeId} ${resourceId}`, data)
                  // updates metafields with the generated tag id
                  return appSdk.apiRequest(
                    storeId,
                    `/orders/${resourceId}/metafields.json`,
                    'POST',
                    {
                      namespace: 'app-freteclick',
                      field: 'rastreio',
                      value: data.id
                    },
                    auth
                  )
                  .then(() => data)
                  .catch(err => {
                    console.log('Erro hidden data')
                    if (err.response) {
                      console.log(err.response)
                      const { status, data } = err.response
                      if (status !== 401 && status !== 403) {
                        if (typeof data === 'object' && data) {
                          console.log(JSON.stringify(data))
                        } else {
                          console.log(data)
                        }
                      }
                    } else {
                      console.error(err)
                    }
                  })
                })
            })
        }
      }
    })
    .then(() => {
      // all done
      res.send(ECHO_SUCCESS)
    })
  })


    .catch(err => {
      if (err.name === SKIP_TRIGGER_NAME) {
        // trigger ignored by app configuration
        res.send(ECHO_SKIP)
      } else if (err.appWithoutAuth === true) {
        const msg = `Webhook for ${storeId} unhandled with no authentication found`
        const error = new Error(msg)
        error.trigger = JSON.stringify(trigger)
        console.error(error)
        res.status(412).send(msg)
      } else {
        // console.error(err)
        // request to Store API with error response
        // return error status code
        res.status(500)
        const { message } = err
        res.send({
          error: ECHO_API_ERROR,
          message
        })
      }
    })
}
