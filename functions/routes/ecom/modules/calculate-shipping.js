const axios = require('axios')
const ecomUtils = require('@ecomplus/utils')
const freteClickApi = require('../../../lib/freteclick/client')

exports.post = async ({ appSdk }, req, res) => {
  /**
   * Treat `params` and (optionally) `application` from request body to properly mount the `response`.
   * JSON Schema reference for Calculate Shipping module objects:
   * `params`: https://apx-mods.e-com.plus/api/v1/calculate_shipping/schema.json?store_id=100
   * `response`: https://apx-mods.e-com.plus/api/v1/calculate_shipping/response_schema.json?store_id=100
   *
   * Examples in published apps:
   * https://github.com/ecomplus/app-mandabem/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   * https://github.com/ecomplus/app-kangu/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   * https://github.com/ecomplus/app-jadlog/blob/master/functions/routes/ecom/modules/calculate-shipping.js
   */

  const { params, application } = req.body
  const { storeId } = req
  // setup basic required response object
  const response = {
    shipping_services: []
  }
  // merge all app options configured by merchant
  const appData = Object.assign({}, application.data, application.hidden_data)

  let shippingRules
  if (Array.isArray(appData.shipping_rules) && appData.shipping_rules.length) {
    shippingRules = appData.shipping_rules
  } else {
    shippingRules = []
  }

  const token = appData.api_key
  if (!token) {
    // must have configured kangu doc number and token
    return res.status(409).send({
      error: 'CALCULATE_AUTH_ERR',
      message: 'Api key or document unset on app hidden data (merchant must configure the app)'
    })
  }

  const marketplace = appData.best_quotation

  const order = 'total'

  if (appData.free_shipping_from_value >= 0) {
    response.free_shipping_from_value = appData.free_shipping_from_value
  }

  const destinationZip = params.to ? params.to.zip.replace(/\D/g, '') : ''
  const originZip = params.from
    ? params.from.zip.replace(/\D/g, '')
    : appData.zip ? appData.zip.replace(/\D/g, '') : ''

  const matchService = (service, name) => {
    const fields = ['service_name', 'service_code']
    for (let i = 0; i < fields.length; i++) {
      if (service[fields[i]]) {
        return service[fields[i]].trim().toUpperCase() === name.toUpperCase()
      }
    }
    return true
  }

  const checkZipCode = rule => {
    // validate rule zip range
    if (destinationZip && rule.zip_range) {
      const { min, max } = rule.zip_range
      return Boolean((!min || destinationZip >= min) && (!max || destinationZip <= max))
    }
    return true
  }

  const getAddress = async (zip) => {
    const destination = {
      "city": "Manaus",
      "state": "AM",
      "country":  "Brasil"
    }

    const options = {
      method: 'GET', 
      url: `https://viacep.com.br/ws/${zip}/json/`,
      timeout: 5000
    };
    try {
      const { data } = await axios.request(options);
      if (data && data.uf && data.localidade) {
        destination.city = data.localidade
        destination.state = data.uf.toUpperCase()
      }
    } catch (error) {
      console.error(error);
    }
    return destination
  }
  const destination = await getAddress(destinationZip)
  const originObj = {}
  if (appData.from && appData.from.city && appData.from.province_code) {
    originObj.city = appData.from.city
    originObj.state = appData.from.province_code
    originObj.country = appData.from.country || 'Brasil'
  }
  const origin = Object.keys(originObj).length ? originObj : await getAddress(originZip)

  // search for configured free shipping rule
  if (Array.isArray(appData.free_shipping_rules)) {
    for (let i = 0; i < appData.free_shipping_rules.length; i++) {
      const rule = appData.free_shipping_rules[i]
      if (rule && checkZipCode(rule)) {
        if (!rule.min_amount) {
          response.free_shipping_from_value = 0
          break
        } else if (!(response.free_shipping_from_value <= rule.min_amount)) {
          response.free_shipping_from_value = rule.min_amount
        }
      }
    }
  }

  if (!params.to) {
    // just a free shipping preview with no shipping address received
    // respond only with free shipping option
    res.send(response)
    return
  }

  /* DO THE STUFF HERE TO FILL RESPONSE OBJECT WITH SHIPPING SERVICES */

  if (!originZip) {
    // must have configured origin zip code to continue
    return res.status(409).send({
      error: 'CALCULATE_ERR',
      message: 'Zip code is unset on app hidden data (merchant must configure the app)'
    })
  }

  console.log('Before quote', storeId)

  if (params.items) {
    let finalWeight = 0
    let cartSubtotal = 0
    const packages = []
    params.items.forEach((item) => {
      const { quantity, dimensions, weight } = item
      let physicalWeight = 0
      // sum physical weight
      if (weight && weight.value) {
        switch (weight.unit) {
          case 'kg':
            physicalWeight = weight.value
            break
          case 'g':
            physicalWeight = weight.value / 1000
            break
          case 'mg':
            physicalWeight = weight.value / 1000000
        }
      }
      finalWeight += (quantity * physicalWeight)
      cartSubtotal += (quantity * ecomUtils.price(item))

      // parse cart items to kangu schema
      let kgWeight = 0
      if (weight && weight.value) {
        switch (weight.unit) {
          case 'g':
            kgWeight = weight.value / 1000
            break
          case 'mg':
            kgWeight = weight.value / 1000000
            break
          default:
            kgWeight = weight.value
        }
      }
      const cmDimensions = {}
      if (dimensions) {
        for (const side in dimensions) {
          const dimension = dimensions[side]
          if (dimension && dimension.value) {
            switch (dimension.unit) {
              case 'm':
                cmDimensions[side] = dimension.value * 100
                break
              case 'mm':
                cmDimensions[side] = dimension.value / 10
                break
              default:
                cmDimensions[side] = dimension.value
            }
          }
        }
      }
      packages.push({
        weight: kgWeight || 5,
        height: cmDimensions.height || 5,
        width: cmDimensions.width || 10,
        depth: cmDimensions.length || 10,
        qtd: quantity
      })
    })
    const productType = 'ecommerce'

    const productTotalPrice = cartSubtotal || 1
    const quoteType = 'full'

    const body = {
      destination,
      origin,
      productType,
      productTotalPrice,
      quoteType,
      marketplace,
      packages,
      app: 'E-Com Plus'
    }
    // send POST request to kangu REST 
    
    return freteClickApi({
      url: '/quotes',
      method: 'post',
      token,
      data: body
    }).then(({ data, status }) => {
        let result
        if (typeof data === 'string') {
          try {
            result = JSON.parse(data)
          } catch (e) {
            console.log('> Frete Click invalid JSON response', data)
            return res.status(409).send({
              error: 'CALCULATE_INVALID_RES',
              message: data
            })
          }
        } else {
          result = data && data.response && data.response.data && data.response.data.order && data.response.data.order.quotes
        }

        if (result && Number(status) === 200 && Array.isArray(result)) {
          // success response
          console.log('Quote with success', storeId)
          let lowestPriceShipping
          result.forEach(freteClickService => {
            const { carrier } = freteClickService
            // parse to E-Com Plus shipping line object
            const serviceCode = carrier && carrier.id
            const price = freteClickService.total

            // push shipping service object to response
            const shippingLine = {
              from: {
                ...params.from,
                ...appData.from,
                zip: originZip
              },
              to: params.to,
              price,
              total_price: price,
              discount: 0,
              delivery_time: {
                days: parseInt(freteClickService.deliveryDeadline, 10),
                working_days: true
              },
              posting_deadline: {
                days: 3,
                ...appData.posting_deadline
              },
              package: {
                weight: {
                  value: finalWeight,
                  unit: 'g'
                }
              },
              custom_fields: [
                {
                  field: 'freteclick_id',
                  value: freteClickService.id
                }
              ],
              flags: ['freteclick-ws', `freteclick-${serviceCode}`.substr(0, 20)]
            }
            if (!lowestPriceShipping || lowestPriceShipping.price > price) {
              lowestPriceShipping = shippingLine
            }

            if (shippingLine.posting_deadline && shippingLine.posting_deadline.days >= 0) {
              shippingLine.posting_deadline.days += parseInt(freteClickService.retrieveDeadline, 10)
            }

            // check for default configured additional/discount price
            if (appData.additional_price) {
              if (appData.additional_price > 0) {
                shippingLine.other_additionals = [{
                  tag: 'additional_price',
                  label: 'Adicional padrão',
                  price: appData.additional_price
                }]
              } else {
                // negative additional price to apply discount
                shippingLine.discount -= appData.additional_price
              }
              // update total price
              shippingLine.total_price += appData.additional_price
            }

            // search for discount by shipping rule
            const shippingName = carrier.alias || carrier.name
            if (Array.isArray(shippingRules)) {
              for (let i = 0; i < shippingRules.length; i++) {
                const rule = shippingRules[i]
                if (
                  rule &&
                  matchService(rule, shippingName) &&
                  checkZipCode(rule) &&
                  !(rule.min_amount > params.subtotal)
                ) {
                  // valid shipping rule
                  if (rule.discount && rule.service_name) {
                    let discountValue = rule.discount.value
                    if (rule.discount.percentage) {
                      discountValue *= (shippingLine.total_price / 100)
                    }
                    shippingLine.discount += discountValue
                    shippingLine.total_price -= discountValue
                    if (shippingLine.total_price < 0) {
                      shippingLine.total_price = 0
                    }
                    break
                  }
                }
              }
            }

            // change label
            let label = shippingName
            if (appData.services && Array.isArray(appData.services) && appData.services.length) {
              const service = appData.services.find(service => {
                return service && matchService(service, label)
              })
              if (service && service.label) {
                label = service.label
              }
            }

            const serviceCodeName = shippingName.replaceAll(' ', '_').toLowerCase()

            response.shipping_services.push({
              label,
              carrier: freteClickService.name,
              service_name: serviceCodeName || shippingName,
              service_code: serviceCode,
              shipping_line: shippingLine
            })
          })

          if (lowestPriceShipping) {
            const { price } = lowestPriceShipping
            const discount = typeof response.free_shipping_from_value === 'number' &&
              response.free_shipping_from_value <= cartSubtotal
              ? price
              : 0
            if (discount) {
              lowestPriceShipping.total_price = price - discount
              lowestPriceShipping.discount = discount
            }
          }
          res.send(response)
        } else {
          // console.log(data)
          const err = new Error('Invalid Frete Click calculate response', storeId, JSON.stringify(body))
          err.response = { data, status }
          throw err
        }
      })
      .catch(err => {
        let { message, response } = err
        console.log('>> Frete Click message error', message)
        console.log('>> Frete Click response error', response)

        if (response && response.data) {
          // try to handle Frete Click error response
          const { data } = response
          let result
          if (typeof data === 'string') {
            try {
              result = JSON.parse(data)
            } catch (e) {
            }
          } else {
            result = data
          }
          if (result && result.data) {
            // Frete Click error message
            return res.status(409).send({
              error: 'CALCULATE_FAILED',
              message: result.data
            })
          }
          message = `${message} (${response.status})`
        } else {
          console.error(err)
        }
        console.log('error', err)
        return res.status(409).send({
          error: 'CALCULATE_ERR',
          message
        })
      })
  } else {
    res.status(400).send({
      error: 'CALCULATE_EMPTY_CART',
      message: 'Cannot calculate shipping without cart items'
    })
  }

  res.send(response)
}
