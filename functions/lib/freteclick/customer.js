const freteClickApi = require('./client')
const ecomUtils = require('@ecomplus/utils')

module.exports = async (token, customer, address) => {
  try {
    const { data } = await freteClickApi({
      url: `/people/customer?email=${customer.main_email}`,
      method: 'get',
      token
    }, {
      validateStatus (status) {
        return status === 200
      }
    })
    if (!data?.response?.data) {
      const err = new Error('Unexpected Freteclick response on customer list')
      err.data = data && JSON.stringify(data)
      throw err
    }
    const id = data.response.data.peopleId || data.response.data.id
    if (id) return id
  } catch (error) {
    if (error.response?.status !== 404) {
      throw error
    }
  }
  const body = {
    name: ecomUtils.fullName(customer),
    type: customer.registry_type === 'p' ? 'F' : 'J',
    document: customer.doc_number,
    email: customer.main_email,
    address: {
      country: 'Brasil',
      state: address.province_code,
      city: address.city,
      district: address.borough,
      complement: address.complement || '',
      street: address.street,
      number: String(address.number || 0),
      postal_code: String(address.zip.replace(/\D/g, ''))
    }
  }
  const { data } = await freteClickApi({
    url: '/people/customer',
    method: 'post',
    token,
    data: body
  })
  if (data?.response?.data) {
    const id = data.response.data.peopleId || data.response.data.id
    if (id) return id
  }
  const err = new Error('Unexpected Freteclick response on customer creation')
  err.data = data && JSON.stringify(data)
  throw err
}
