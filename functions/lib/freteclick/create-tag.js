/* eslint-disable quote-props, quotes */
const { logger } = require('firebase-functions')
const getOrCreateCustomerId = require('./customer')
const getCompany = require('./me')
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
  const fcCompany = await getCompany(token)
  logger.info(`Freteclick ids for #${storeId}`, { fcCompany })
  const customer = order.buyers?.[0]
  const address = order.shipping_lines?.[0]?.to
  const retrieve = {
    ...appData.from,
    zip: appData.zip,
    ...(order.shipping_lines?.[0]?.from)
  }
  const freteClickCustom = (order, field) => {
    const shippingCustom = order.shipping_lines?.[0]?.custom_fields
    const customField = shippingCustom?.find(custom => custom.field === field)
    if (customField !== undefined && customField !== 'false') {
      return customField.value
    } else {
      return false
    }
  }
  const fcQuoteId = freteClickCustom(order, 'freteclick_id')
  const fcOrderId = freteClickCustom(order, 'freteclick_order_id')
  let fcCustomerId
  try {
    fcCustomerId = await getOrCreateCustomerId(token, customer, address)
  } catch (error) {
    if (error.response) {
      error.message = `Request failed handling customer for #${storeId} ${order._id}`
      debugAxiosError(error)
    } else {
      logger.error(error, { storeId, orderId: order._id })
    }
    throw error
  }
  logger.info(`Freteclick customer ${fcCustomerId} for #${storeId} ${order._id}`)
  const data = {
    "quote": fcQuoteId,
    "price": order.amount && order.amount.freight,
    "payer": fcCompany.companyId,
    "retrieve": {
      "id": fcCompany.companyId,
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
      "contact": fcCompany.peopleId
    },
    "delivery": {
      fcOrderId,
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
      "contact": fcOrderId
    }
  }
  logger.info(`Freteclick tag for #${storeId} ${order._id}`, { data })

  return client({
    url: `/purchasing/orders/${fcOrderId}/choose-quote`,
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
