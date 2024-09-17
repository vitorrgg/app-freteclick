const { logger } = require('firebase-functions')
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

  appSdk.getAuth(storeId).then(async auth => {
    const appData = await getAppData({ appSdk, storeId, auth })
    if (
      trigger.resource !== 'orders' ||
      appData.ignore_triggers?.indexOf?.(trigger.resource) > -1
    ) {
      // ignore current trigger
      const err = new Error()
      err.name = SKIP_TRIGGER_NAME
      throw err
    }
    if (appData.send_tag_status && appData.api_key) {
      // handle order financial status changes
      if (trigger.body?.financial_status?.current === 'paid') {
        const orderId = trigger.resource_id
        const { response } = await appSdk.apiRequest(
          storeId,
          `/orders/${orderId}.json`,
          'GET',
          null,
          auth
        )
        const order = response.data
        const shippingLine = order.shipping_lines?.[0]
        if (shippingLine?.flags?.includes('freteclick-ws')) {
          const trackingCodes = shippingLine.tracking_codes || []
          if (!trackingCodes.some(({ tag }) => tag === 'freteclick')) {
            logger.info(`Start creating tag for #${storeId} ${orderId}`)
            const data = await createTag(order, storeId, appData, appSdk)
            logger.info(`Tag created for #${storeId} ${orderId}`, { data })
            trackingCodes.push({
              code: data.id,
              link: 'https://www.freteclick.com.br/rastreamento',
              tag: 'freteclick'
            })
            await appSdk.apiRequest(
              storeId,
              `/orders/${orderId}/shipping_lines/${shippingLine._id}.json`,
              'PATCH',
              { tracking_codes: trackingCodes },
              auth
            )
          }
        }
      }
    }
    res.send(ECHO_SUCCESS)
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
