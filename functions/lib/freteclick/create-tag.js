/* eslint-disable quote-props, quotes */
const { logger } = require('firebase-functions')
const getOrCreateCustomer = require('./customer')
const getCompanyId = require('./me')
const client = require('./client')

const debugAxiosError = error => {
  const err = new Error(error.message)
  if (error.response) {
    err.status = error.response.status
    err.response = error.response.data
  }
  err.request = error.config
  logger.error(err)
}

module.exports = async (order, storeId, appData, appSdk) => {
  let token = appData.api_key
  const shippingLine = order.shipping_lines[0]
  const warehouseCode = shippingLine.warehouse_code
  if (warehouseCode) {
    const warehouse = appData.warehouses?.find(({ code }) => code === warehouseCode)
    if (warehouse.api_key) {
      token = warehouse.api_key
    }
  }
  const { peopleId, companyId } = await getCompanyId(token)
  logger.info(`Freteclick ids for #${storeId}`, { peopleId, companyId })
  const customer = order.buyers?.[0]
  const address = order.shipping_lines?.[0]?.to
  const retrieve = {
    ...appData.from,
    zip: appData.zip,
    ...(order.shipping_lines?.[0]?.from)
  }
  const freteClickCustom = (order, field) => {
    const shippingCustom = order.shipping_lines[0] && order.shipping_lines[0].custom_fields
    const customField = shippingCustom.find(custom => custom.field === field)
    if (customField !== undefined && customField !== 'false') {
      return customField.value
    } else {
      return false
    }
  }
  const quoteId = freteClickCustom(order, 'freteclick_id')
  const orderId = freteClickCustom(order, 'freteclick_order_id')
  let id
  try {
    id = (await getOrCreateCustomer(token, customer, address)).id
  } catch (error) {
    if (error.response) {
      debugAxiosError(error)
    } else {
      logger.error(error)
    }
    throw error
  }
  logger.info(`Freteclick customer ${id} for #${storeId}`)
  const data = {
    "quote": quoteId,
    "price": order.amount && order.amount.freight,
    "payer": companyId,
    "retrieve": {
      "id": companyId,
      "address": {
        "id": null,
        "country": retrieve.country || "Brasil",
        "state": retrieve.province_code,
        "city": retrieve.city,
        "district": retrieve.borough,
        "complement": retrieve.complement || "",
        "street": retrieve.street,
        "number": String(retrieve.number || 0),
        "postal_code": String(retrieve.zip.replace(/\D/g, ''))
      },
      "contact": peopleId
    },
    "delivery": {
      id,
      "address": {
        "id": null,
        "country": address.country || "Brasil",
        "state": address.province_code,
        "city": address.city,
        "district": address.borough,
        "complement": address.complement || "",
        "street": address.street,
        "number": String(address.number || 0),
        "postal_code": String(address.zip.replace(/\D/g, ''))
      },
      "contact": id
    }
  }
  logger.info(`Freteclick tag for ${storeId} ${order._id}`, { data })

  return client({
    url: `/purchasing/orders/${orderId}/choose-quote`,
    method: 'put',
    token,
    data
  })
    .then(res => res.data)
    .catch(err => {
      debugAxiosError(err)
      throw err
    })
}
