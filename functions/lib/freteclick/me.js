const freteClickApi = require('./client')

module.exports = async (token) => {
  const { data, status } = await freteClickApi({
    url: '/people/me',
    method: 'get',
    token
  })
  if (status === 200 && data && data.response && data.response.data) {
    const { peopleId, companyId } = data.response.data
    return {
      peopleId,
      companyId
    }
  }
}
