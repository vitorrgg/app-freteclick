const axios = require('axios')
const ecomUtils = require('@ecomplus/utils')
const { logger } = require('firebase-functions')
const freteClickApi = require('./client')
const getOrCreateCustomer = require('./customer')
const getCompanyId = require('./me')
const client = require('./client')

module.exports = async (order, token, storeId, appData, appSdk) => {
// create new shipping tag with Kangu
// https://portal.kangu.com.br/docs/api/transporte/#/
  const {
    peopleId,
    companyId
  } = await getCompanyId(token)
  const customer = order.buyers && order.buyers.length && order.buyers[0]
  const address = order.shipping_lines && order.shipping_lines.length && order.shipping_lines[0] && order.shipping_lines.length && order.shipping_lines[0].to
  const retrieve = order.shipping_lines && order.shipping_lines.length && order.shipping_lines[0] && order.shipping_lines.length && order.shipping_lines[0].from || {
    ...appData.from,
    zip: appData.zip
  }
  const freteClickCustom = (order, field) => {
    const shippingCustom = order.shipping_lines[0] && order.shipping_lines[0].custom_fields
    const customField = shippingCustom.find(custom => custom.field === field); 
    if (customField !== undefined && customField !== 'false') {
      return customField.value
    } else {
      return false
    }
  }
  const quoteId = freteClickCustom(order, 'freteclick_id')
  const orderId = freteClickCustom(order, 'freteclick_order_id')
  const { id } =  await getOrCreateCustomer(token, customer, address)
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

  

  const debugAxiosError = error => {
    const err = new Error(error.message)
    if (error.response) {
      err.status = error.response.status
      err.response = error.response.data
    }
    err.request = error.config
    logger.error(err)
  }
  console.log('frete click body', JSON.stringify(data))

  return client({
    url: `/purchasing/orders/${orderId}/choose-quote`,
    method: 'put',
    token,
    data
  }).then(res => res.data)
    .catch(err => {
      console.log('erro ao gerar tag', err)
      debugAxiosError(err)
      throw err
    })
}
