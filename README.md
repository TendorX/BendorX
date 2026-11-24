# Bendor-X

Каталог Telegram-сообществ в формате Telegram Mini App.

## Проект

- Интерфейс: React + Vite
- Публикация: GitHub Pages через GitHub Actions
- Авторизация и данные: Supabase
- Telegram-бот: [@BendorX_bot](https://t.me/BendorX_bot)

## Публичная версия

https://tendorx.github.io/BendorX/

## Публикация

При каждом push в ветку `main` GitHub Actions собирает приложение в `dist/`, проверяет наличие стартовой страницы и публичной конфигурации, а затем публикует только готовую production-сборку в GitHub Pages.

В репозитории: **Settings → Pages → Build and deployment → Source** должно быть выбрано **GitHub Actions**.

## Локальная разработка

```bash
npm install
npm run dev
```

Production-сборка:

```bash
npm run build
```
