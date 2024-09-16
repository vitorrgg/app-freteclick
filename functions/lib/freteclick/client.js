const axios = require('axios')

const instance = axios.create({
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
})

module.exports = ({
  url,
  method,
  token,
  data,
  timeout = 8000
}, axiosConfig = {}) => {
  const config = {
    ...axiosConfig,
    url,
    method,
    headers: {
      'api-token': token,
      accept: 'application/json',
      'Content-Type': 'application/json'
    },
    data,
    timeout
  }
  instance.defaults.baseURL = 'https://api.freteclick.com.br'
  return instance(config)
}
