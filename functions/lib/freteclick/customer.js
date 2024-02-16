const freteClickApi = require('./client')
const ecomUtils = require('@ecomplus/utils')

module.exports = async (token, customer, address) => {
  const { data, status } = await freteClickApi({
    url: `/people/customer?email=${customer.main_email}`,
    method: 'get',
    token
  })
  if (status === 200 && data && data.response && data.response.data && data.response.count) {
    const { id } = data.response.data
    return {
      id
    }
  } else if (status === 200 && data && data.response && data.response.data && data.response.count === 0) {
    const body = {
      "name": ecomUtils.fullName(customer),
      "type": customer.registry_type === 'p' ? 'F' : 'J', 
      "document": customer.doc_number,
      "email": customer.main_email,
      "address": {
          "country": address.country || "Brasil",
          "state": address.province_code,
          "city": address.city,
          "district": address.borough,
          "complement": address.complement || "",
          "street": address.street,
          "number": String(address.number || 0),
          "postal_code": String(address.zip.replace(/\D/g, ''))
      }
    }
    const response = await freteClickApi({
      url: `/people/customer`,
      method: 'post',
      token,
      data: body
    })
    const { id } = response && response.data && response.data.response && response.data.response.data
    return {
      id
    }
  }
}
