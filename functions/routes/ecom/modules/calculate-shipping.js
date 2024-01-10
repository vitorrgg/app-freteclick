const axios = require('axios')
const ecomUtils = require('@ecomplus/utils')

exports.post = ({ appSdk }, req, res) => {
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

  const token = appData.kangu_token
  if (!token) {
    // must have configured kangu doc number and token
    return res.status(409).send({
      error: 'CALCULATE_AUTH_ERR',
      message: 'Token or document unset on app hidden data (merchant must configure the app)'
    })
  }

  const ordernar = appData.ordernar ? appData.ordernar : 'preco'

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

  const completeAddress = address => {
    const { logradouro, numero, complemento, bairro, cidade, distancia } = address
    let lineAddress
    if (logradouro) {
      lineAddress = logradouro
      if (numero) {
        lineAddress += ', ' + numero
      }
      if (complemento) {
        lineAddress += ' - ' + complemento
      }
      if (bairro) {
        lineAddress += ', ' + bairro
      }
      if (cidade) {
        lineAddress += ', ' + cidade
      }
      if (logradouro) {
        lineAddress += ' - ' + distancia + 'm'
      }
    } else {
      lineAddress = ''
    }
    return lineAddress
  }

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
      const { name, quantity, dimensions, weight } = item
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
        peso: kgWeight || 0.5,
        altura: cmDimensions.height || 5,
        largura: cmDimensions.width || 10,
        comprimento: cmDimensions.length || 10,
        valor: ecomUtils.price(item),
        quantidade: quantity
      })
    })

    const body = {
      cepOrigem: originZip,
      cepDestino: destinationZip,
      origem: 'E-Com Plus',
      ordernar,
      packages
    }
    // send POST request to kangu REST API
    return axios.post(
      'https://api.freteclick.com.br/quotes',
      body,
      {
        headers: {
          token,
          accept: 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    ).then(({ data, status }) => {
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
          result = data
        }

        if (result && Number(status) === 200 && Array.isArray(result)) {
          // success response
          console.log('Quote with success', storeId)
          let lowestPriceShipping
          result.forEach(freteClickService => {
            // parse to E-Com Plus shipping line object
            const serviceCode = String(freteClickService.servico)
            const price = freteClickService.vlrFrete
            const kanguPickup = Array.isArray(freteClickService.pontosRetira)
              ? freteClickService.pontosRetira[0]
              : false

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
                days: parseInt(freteClickService.prazoEnt, 10),
                working_days: true
              },
              delivery_instructions: kanguPickup
                ? `${kanguPickup.nome} - ${completeAddress(kanguPickup.endereco)}`
                : undefined,
              posting_deadline: {
                days: 3,
                ...appData.posting_deadline
              },
              package: {
                weight: {
                  value: finalWeight,
                  unit: 'kg'
                }
              },
              custom_fields: [
                {
                  field: 'kangu_reference',
                  value: kanguPickup
                    ? String(kanguPickup.referencia)
                    : String(freteClickService.referencia)
                },
                {
                  field: 'nfe_required',
                  value: freteClickService.nf_obrig === 'N' ? 'false' : 'true'
                }
              ],
              flags: ['kangu-ws', `kangu-${serviceCode}`.substr(0, 20)]
            }
            if (!lowestPriceShipping || lowestPriceShipping.price > price) {
              lowestPriceShipping = shippingLine
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
            const shippingName = freteClickService.transp_nome || freteClickService.descricao
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
              carrier: freteClickService.transp_nome,
              carrier_doc_number: typeof freteClickService.cnpjTransp === 'string'
                ? freteClickService.cnpjTransp.replace(/\D/g, '').substr(0, 19)
                : undefined,
              service_name: serviceCode || freteClickService.descricao,
              service_code: serviceCodeName.substring(0, 70),
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
