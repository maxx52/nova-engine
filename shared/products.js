import {validateSeo} from './seo.js'
export function validateProduct(body) {
  const seoError=validateSeo(body?.seo);if(seoError)return seoError
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 150) return 'Название: от 1 до 150 символов'
  if (typeof body.category !== 'string' || !body.category.trim() || body.category.trim().length > 100) return 'Укажите категорию'
  if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0 || body.price > 9999999999.99 || Math.round(body.price*100)/100!==body.price) return 'Некорректная цена'
  if (typeof body.description !== 'string' || body.description.length > 20000) return 'Некорректное описание'
  if (body.sku !== undefined && (typeof body.sku !== 'string' || body.sku.length > 100)) return 'Некорректный артикул'
  if (body.stock !== undefined && (!Number.isSafeInteger(body.stock) || body.stock < 0 || body.stock>2147483647)) return 'Некорректный остаток'
  if (body.published !== undefined && typeof body.published !== 'boolean') return 'Некорректный статус'
  if (body.image_url !== undefined && (typeof body.image_url !== 'string' || !/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(body.image_url) && body.image_url !== '')) return 'Некорректное изображение'
  if(body.images !== undefined && (!Array.isArray(body.images) || body.images.length > 12 || body.images.some(url => typeof url !== 'string' || !/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(url)) || new Set(body.images).size !== body.images.length)) return 'Галерея: до 12 уникальных изображений'
  if(body.images && body.image_url && !body.images.includes(body.image_url)) return 'Главное фото должно быть в галерее'
  const attrs=body.attributes??[]
  if(!Array.isArray(attrs)||attrs.length>50||attrs.some(a=>!a||typeof a.name!=='string'||!a.name.trim()||a.name.length>80||typeof a.value!=='string'||!a.value.trim()||a.value.length>300))return 'Некорректные характеристики'
  const variants=body.variants??[]
  if(!Array.isArray(variants)||variants.length>100||variants.some(v=>!v||typeof v.name!=='string'||!v.name.trim()||v.name.length>120||typeof v.sku!=='string'||v.sku.length>100||typeof v.price!=='number'||!Number.isFinite(v.price)||v.price<0||v.price>9999999999.99||Math.round(v.price*100)/100!==v.price||!Number.isSafeInteger(v.stock)||v.stock<0||v.stock>2147483647))return 'Некорректные варианты товара'
  if(new Set(variants.map(v=>v.name.trim().toLowerCase())).size!==variants.length)return 'Названия вариантов должны быть уникальными'
  return null
}
