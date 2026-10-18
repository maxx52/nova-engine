# Зашифрованные копии NOVA в Яндекс Диске

Дополнение к менеджеру 0.21.2 для native VDS. Отдельная служба каждые 15 минут отправляет только полные локальные копии с успешной проверкой восстановления. Работа сайта не приостанавливается повторно. Новые копии отправляются первыми, ошибки повторяются при следующем запуске. Локальное расписание и хранение 7/14/30 дней продолжают работать независимо.

Используются rclone из репозитория ОС, HTTPS WebDAV `https://webdav.yandex.ru` и rclone crypt: шифруются содержимое и имена файлов. Каталог: **`NOVA-Backups/nova.maxxdev.ru`**. Пароли никогда не передаются в аргументах процессов, HTTP API CMS или GitHub. Конфигурация `/etc/nova/yandex-rclone.conf` доступна только root (600); obscured-поля rclone сами по себе не являются защищённым хранилищем паролей. Служба root работает с файловой системой только на чтение, кроме собственного staging/журнала в `/var/lib/nova-external-backup`.

После отправки rclone скачивает данные через crypt и сравнивает с локальной копией (`check --download --one-way`). Только после этого записывается зашифрованный `_COMPLETE.json` и локальная квитанция. Незавершённая отправка не считается успешной. Контрольные суммы локальных архивов сверяются перед отправкой. Временная локальная копия защищает чтение от одновременной очистки старых локальных архивов.

## Установка администратором VDS

Из проверенного checkout этого репозитория:

```bash
sudo apt-get update
sudo apt-get install -y rclone
sudo install -d -m 755 /usr/local/lib/nova-external-backup
sudo install -d -m 700 /var/lib/nova-external-backup
sudo install -m 644 deploy/external-backup/yandex.py /usr/local/lib/nova-external-backup/yandex.py
sudo install -m 644 deploy/external-backup/nova-external-backup.service /etc/systemd/system/nova-external-backup.service
sudo install -m 644 deploy/external-backup/nova-external-backup.timer /etc/systemd/system/nova-external-backup.timer
sudo systemctl daemon-reload
sudo python3 /usr/local/lib/nova-external-backup/yandex.py setup
```

Перед запуском адаптируйте фиксированные пути/папку в Python под другую установку. Web/API команд для настройки учётных данных нет.

В Яндекс ID создайте **отдельный пароль приложения типа «Файлы WebDAV»**, например с именем `NOVA backups`. Основной пароль Яндекса не подходит. Введите логин и этот пароль только в своём терминале VDS, не в чате. Затем задайте отдельный длинный пароль шифрования (от 20 символов) и **сохраните его у себя вне VDS**. Он не совпадает с паролем приложения. Дополнительный salt/password2 не задаётся: для аварийного восстановления достаточно сохранённого пароля и настроек crypt из этого руководства.

`setup` проверит шифрованную запись и чтение случайных 64 байт, включит таймер и запустит отправку существующих проверенных копий. При сбое проверки конфигурация остаётся приватной, таймер ещё не включён. После исправления доступа/сети повторите `test`, не меняя пароль шифрования:

```bash
sudo python3 /usr/local/lib/nova-external-backup/yandex.py test
sudo python3 /usr/local/lib/nova-external-backup/yandex.py status
sudo systemctl status nova-external-backup.service --no-pager
sudo systemctl list-timers nova-external-backup.timer --no-pager
```

`configured: true` означает только успешное подключение. Первая реальная внешняя копия подтверждена, когда `status` содержит `last_success` и `last_backup_id`, а `error` пуст. Состояние внешней службы пока проверяется этой командой, отдельно от списка локальных копий в админке 0.21.2.

**Удаления в Яндекс Диске нет:** ни `sync`, ни `purge` для удалённого хранилища не вызываются. Внешние копии сохраняются до ручной очистки владельцем. Контролируйте свободное место/квоту; локальный срок 7 дней не распространяется на Яндекс Диск. Служба повторяет сбои, но уведомления по email/Telegram пока не отправляет. У приложения WebDAV есть доступ к Диску аккаунта, хотя наш код обращается только к папке копий. Для более строгого разделения используйте отдельный аккаунт Яндекса.

## Восстановление после потери VDS

Не рассчитывайте только на `/etc/nova/yandex-rclone.conf` на потерянном сервере. Сохраните пароль шифрования и это руководство отдельно. Не публикуйте конфигурацию: она содержит обратимо скрытые пароли. Новый пароль приложения Яндекса можно выпустить заново, пароль шифрования старых копий заменять нельзя.

На новом доверенном сервере установите rclone, настройте WebDAV remote `yandex` и crypt remote `nova-crypt` с **прежним** паролем шифрования, `password2` пустым, `filename_encryption=standard`, `directory_name_encryption=true`, `remote=yandex:NOVA-Backups/nova.maxxdev.ru`. Через `rclone lsf nova-crypt:` найдите нужный ID. Скачайте его в новый приватный каталог:

```bash
umask 077
rclone --config /etc/nova/yandex-rclone.conf copy nova-crypt:ID /var/backups/nova-system/ID
```

Замените оба `ID` реальным идентификатором. Убедитесь в наличии `_COMPLETE.json`, затем сверяйте SHA-256 файлов с `metadata.json` и проверяйте копию локальным менеджером (`system-client.py verify ID`). Рабочую базу заменяйте только через штатное подтверждённое восстановление. Для первой аварийной установки после полной потери сервера нужны также Node.js/systemd/PostgreSQL, пользователь приложения и nginx/SSL: конфигурация ОС/другие сайты в копии отсутствуют.

Официальные справки: [Яндекс WebDAV](https://yandex.ru/support/yandex-360/customers/disk/web/ru/webdav), [rclone crypt](https://rclone.org/crypt/), [rclone check](https://rclone.org/commands/rclone_check/).
