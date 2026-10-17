import {formId} from './forms.js'
import {safeLink} from './contentSafety.js'
const imagePattern=/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/
export function validateSections(sections) {
  if (!Array.isArray(sections) || sections.length > 50 || JSON.stringify(sections).length>1000000) return 'Максимум 50 секций'
  const ids = new Set()
  for (const section of sections) {
    if (!section || typeof section.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(section.id) || ids.has(section.id)) return 'Некорректный идентификатор секции'
    ids.add(section.id)
    if(section.type==='form'){if(!formId(section.form_id))return 'Выберите форму обратной связи';continue}
    if(section.type==='code'){
      if(!section.code||typeof section.code!=='object'||['html','css','js'].some(key=>typeof section.code[key]!=='string'||section.code[key].length>100000))return 'Код секции: HTML, CSS и JavaScript до 100 000 символов каждый'
      continue
    }
    if (!['hero', 'text', 'image'].includes(section.type)) return 'Неизвестный тип секции'
    for (const [key, max] of [['title',300],['text',20000],['image_url',200],['alt',300],['caption',1000],['button_text',100],['button_url',2000]]) {
      if (typeof section[key] !== 'string' || section[key].length > max) return 'Некорректное поле секции: ' + key
    }
    if (section.image_url && !imagePattern.test(section.image_url)) return 'Некорректное изображение секции'
    if (!safeLink(section.button_url)) return 'Кнопка: используйте путь /about или адрес https://…'
    if (section.button_text && !section.button_url) return 'Укажите адрес кнопки'
  }
  return null
}
