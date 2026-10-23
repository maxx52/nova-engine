import {validateActiveTheme} from './themes.js'
import {safeLink,mediaUrl} from './contentSafety.js'
export const textGroups = {
 'Первый экран': {
  hero_eyebrow:'ПРОСТРАНСТВО ВОЗМОЖНОСТЕЙ',hero_title:'Вещи, которые',hero_accent:'делают жизнь',hero_end:'интереснее.',hero_description:'Технологии, уют и детали на каждый день. Откройте подборку товаров в нашем демонстрационном магазине.',hero_button:'Смотреть каталог',hero_note:'Больше выбора. Меньше лишнего.',hero_main_icon:'🎧',hero_second_icon:'🎒',hero_float_icon:'✦',hero_float_title:'Выбирай лучшее',hero_float_text:'Каждый день'
 },
 'Преимущества':{benefit_1_icon:'✧',benefit_1_title:'Удобный выбор',benefit_1_text:'Всё необходимое рядом',benefit_2_icon:'♧',benefit_2_title:'Разные категории',benefit_2_text:'Товары на каждый день',benefit_3_icon:'♡',benefit_3_title:'С любовью к деталям',benefit_3_text:'Продуманный ассортимент'},
 'Каталог и товар':{catalog_kicker:'НАШ АССОРТИМЕНТ',catalog_title:'Популярные товары',catalog_description:'Откройте для себя что-то новое.',found:'Найдено:',all_products:'Все товары',all_attributes:'Все характеристики',search:'Поиск товаров...',badge_1:'ХИТ ПРОДАЖ',badge_2:'ВЫБОР NOVA',add_to_cart:'В корзину ↗',no_products:'По вашему запросу товары не найдены.',back_catalog:'← Назад в каталог',sku:'Артикул:',no_sku:'не указан',in_stock:'● В наличии:',out_of_stock:'Нет в наличии',choose_variant:'Выберите вариант',product_add:'Добавить в корзину →',description:'Описание товара',no_description:'Описание пока не добавлено.',attributes:'Характеристики',fallback_icon:'📦'},
 'Шапка и подвал':{announcement:'',footer_text:'Демонстрация платформы',footer_credit:'Создано на Vue 3 + JavaScript'},
 'Корзина':{cart:'Корзина',cart_kicker:'ВАШИ ПОКУПКИ',cart_empty:'В корзине пока пусто',cart_hint:'Добавьте понравившиеся товары из каталога.',cart_shop:'К покупкам ↗',cart_total:'Итого',cart_note:'Цены и наличие проверяются при оформлении заказа.',checkout:'Оформить заказ',added:'Товар добавлен в корзину',no_variants:'Нет доступных вариантов',variant_unavailable:'Вариант отсутствует'},
 'Оплата':{checkout_online_note:'После оформления можно открыть платёжную форму. Стоимость доставки согласуется отдельно.',payment_manual:'Поступление оплаты проверяет менеджер. Не оплачивайте заказ повторно, если деньги уже списаны.',payment_open:'Перейти к оплате',payment_loading:'Загрузка…',payment_link:'Открыть платёжную страницу',payment_refresh:'Обновить статус оплаты',payment_paid:'Оплата подтверждена магазином',payment_refunded:'Возврат подтверждён магазином',payment_unavailable:'Оплата сейчас недоступна. Обратитесь в магазин.',payment_reference:'Номер заказа для оплаты:',payment_amount_notice:'Проверьте сумму и номер заказа в платёжной форме перед подтверждением.',payment_error:'Не удалось открыть оплату'},
 'Оформление заказа':{checkout_title:'Оформление заказа',checkout_intro:'Укажите контакты, чтобы мы могли подтвердить заказ.',customer_name:'Имя',customer_phone:'Телефон',customer_email:'Электронная почта (необязательно)',delivery_method:'Способ получения',delivery_pickup:'Самовывоз',delivery_address_method:'Доставка',delivery_address:'Адрес доставки',order_comment:'Комментарий к заказу',checkout_payment_note:'Способ оплаты и время получения подтвердит менеджер.',checkout_privacy:'Отправляя заказ, вы передаёте магазину контактные данные для его обработки.',order_submit:'Отправить заказ',order_sending:'Отправляем…',order_retry:'Проверить отправку',order_success:'Заказ принят',order_received:'Мы свяжемся с вами для подтверждения. Сохраните номер заказа.',order_close:'Продолжить покупки',back_cart:'Вернуться в корзину',checkout_error:'Не удалось оформить заказ',checkout_retry:'Не удалось подтвердить отправку. Нажмите «Проверить отправку»: повторный заказ не создастся.',stock_limit:'Достигнуто доступное количество',checkout_locked:'Завершите проверку отправки заказа в корзине'},
 'Блог':{blog_title:'Блог',blog_all:'← Все статьи',blog_read:'Читать →',blog_empty:'Публикаций по выбранным условиям пока нет.',blog_filter:'Показать',blog_category:'Категория',blog_tag:'Тег',blog_all_categories:'Все категории',blog_all_tags:'Все теги',blog_loading:'Загрузка блога…',blog_back:'К списку статей →',blog_count:'Публикаций:',blog_rubric:'Рубрика',blog_all_rubrics:'Все рубрики'},
 'Служебные подписи':{loading:'Загрузка сайта…',catalog_loading:'Загружаем каталог…',page_loading:'Загрузка страницы…',not_found:'Страница не найдена',home_link:'На главную →',load_error:'Не удалось загрузить данные. Попробуйте обновить страницу.',previous:'← Назад',next:'Далее →',page_number:'Страница'}
}
export const textLabels = {hero_eyebrow:'Надзаголовок',hero_title:'Заголовок: начало',hero_accent:'Заголовок: выделенная строка',hero_end:'Заголовок: окончание',hero_description:'Описание',hero_button:'Текст кнопки',hero_note:'Подпись у кнопки',hero_main_icon:'Основная иллюстрация (эмодзи)',hero_second_icon:'Вторая иллюстрация (эмодзи)',hero_float_icon:'Значок карточки',hero_float_title:'Заголовок карточки',hero_float_text:'Подпись карточки',announcement:'Строка над шапкой (пусто — название сайта)',footer_text:'Текст в подвале',footer_credit:'Подпись автора',fallback_icon:'Значок товара без фотографии'}
export const defaultTexts = Object.assign({},...Object.values(textGroups))
export const defaultDesign = {
 theme:null,
 texts:defaultTexts,
 colors:{primary:'#2c6652',accent:'#4b896e',background:'#ffffff',text:'#192426',hero:'#f4f5ee',footer:'#1c3530'},
 font:'Manrope',radius:12,width:1220,
 visibility:{announcement:true,header:true,hero:true,advantages:true,catalog:true,footer:true,year:true,floating:true},
 home_order:['hero','advantages','catalog'],hero_image_url:'',hero_button_url:'/catalog#catalog',
 code:{enabled:false,placement:'home',html:'<section class="welcome"><h1>Мой сайт</h1><p>Содержимое этого блока можно изменить в редакторе кода.</p><button id="hello">Нажми меня</button><p id="message"></p></section>',css:'.welcome { padding: 48px 24px; font-family: Arial, sans-serif; text-align: center; } button { padding: 12px 20px; cursor: pointer; }',js:'document.getElementById("hello")?.addEventListener("click", () => { document.getElementById("message").textContent = "Всё работает!"; });',global_css:''}
}
export function designValue(value={}){
 const clone=JSON.parse(JSON.stringify(defaultDesign))
 if(value.theme!==undefined)clone.theme=JSON.parse(JSON.stringify(value.theme))
 for(const key of ['font','radius','width','hero_image_url','home_order','hero_button_url'])if(value[key]!==undefined)clone[key]=value[key]
 for(const key of ['texts','colors','visibility','code'])if(value[key]&&typeof value[key]==='object')for(const field of Object.keys(clone[key]))if(Object.hasOwn(value[key],field))clone[key][field]=value[key][field]
 return clone
}
export function validateDesign(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return 'Некорректное оформление'
 if(!Object.hasOwn(value,'theme'))return 'Обновите редактор оформления перед сохранением'
 for(const key of Object.keys(value))if(!Object.hasOwn(defaultDesign,key))return 'Неизвестное поле оформления: '+key
 for(const group of ['texts','colors','visibility','code'])if(!value[group]||typeof value[group]!=='object'||Array.isArray(value[group]))return 'Отсутствует раздел: '+group
 for(const group of ['texts','colors','visibility','code'])for(const key of Object.keys(value[group]))if(!Object.hasOwn(defaultDesign[group],key))return 'Неизвестное поле: '+key
 for(const [key]of Object.entries(defaultTexts))if(typeof value.texts[key]!=='string'||value.texts[key].length>5000)return 'Текст до 5000 символов: '+key
 for(const key of Object.keys(defaultDesign.colors))if(typeof value.colors[key]!=='string'||!/^#[a-f0-9]{6}$/i.test(value.colors[key]))return 'Некорректный цвет: '+key
 for(const key of Object.keys(defaultDesign.visibility))if(typeof value.visibility[key]!=='boolean')return 'Некорректная видимость: '+key
 if(!['Manrope','Arial','Georgia','Verdana'].includes(value.font))return 'Некорректный шрифт'
 if(!Number.isInteger(value.radius)||value.radius<0||value.radius>32||!Number.isInteger(value.width)||value.width<900||value.width>1600)return 'Скругление: 0–32; ширина: 900–1600'
 if(typeof value.hero_button_url!=='string'||!safeLink(value.hero_button_url))return 'Некорректный адрес главной кнопки'
 if(typeof value.hero_image_url!=='string'||value.hero_image_url!==''&&!mediaUrl(value.hero_image_url))return 'Выберите изображение из медиатеки'
 if(!Array.isArray(value.home_order)||value.home_order.length!==3||new Set(value.home_order).size!==3||value.home_order.some(v=>!defaultDesign.home_order.includes(v)))return 'Некорректный порядок разделов'
 if(typeof value.code.enabled!=='boolean'||!['home','footer','site'].includes(value.code.placement))return 'Некорректное размещение кода'
 for(const key of ['html','css','js','global_css'])if(typeof value.code[key]!=='string'||value.code[key].length>100000)return 'До 100 000 символов в файле: '+key
 const themeError=validateActiveTheme(value.theme??null);if(themeError)return themeError
 if(new TextEncoder().encode(JSON.stringify(value)).length>1024*1024)return 'Оформление превышает 1 МиБ UTF-8'
 return null
}
