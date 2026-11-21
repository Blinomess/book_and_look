# Локальная инфраструктура

Основной проверяемый путь: `docker compose up --build -d` из корня.

## Kubernetes (следующий этап, без платного облака)

`generate-k8s.mjs` создаёт `infra/local.yaml`: Namespace, локальные Secret, два PostgreSQL Deployment/PVC/Service, три Deployment/Service приложения. Одна реплика каждого компонента. Образ `campus-booking:local` должен быть доступен кластеру.

Для Docker Desktop Kubernetes после включения кластера:

```powershell
docker build -t campus-booking:local .
node infra/generate-k8s.mjs
kubectl apply -f infra/local.yaml
kubectl -n campus rollout status deployment/gateway
kubectl -n campus get pods
kubectl -n campus port-forward service/gateway 3000:3000
```

Для kind образ нужно загрузить через `kind load docker-image campus-booking:local`. В обоих случаях перейти на http://localhost:3000. Не запускать port-forward на занятом Compose порту: сначала остановить Compose или выбрать `3005:3000`.

Зависимые приложения могут перезапускаться, пока PostgreSQL/Identity не готовы. Readiness не направляет запросы в неподготовленный контейнер. PVC сохраняют данные. Манифест предназначен для локального стенда, без внешнего Ingress и TLS; секреты демонстрационные.

## Jenkins

Jenkinsfile ожидает выделенный Linux-агент с меткой `docker`, Node 22, npm и доступом к Docker daemon. Pipeline выполняет сборку, модульные и PostgreSQL-интеграционные тесты, сборку контейнера. Интеграционные контейнеры запускаются в отдельном Compose-проекте `campus-ci` без production-томов. Автоматическое развёртывание в текущий стенд намеренно пока не настроено: сначала требуется подключить Jenkins и выбрать целевой кластер.
