# hello-world-api translation

Translate the Flask source API in `src/` into a Java Spring Boot API in `dst/`.

The Java service must be a drop-in replacement:

- Listen on the port from the `SERVER_PORT` environment variable.
- Serve `GET /`.
- Return JSON with a `message` field.
- Without `name`, return `{"message":"Hello World!"}`.
- With `name`, trim leading/trailing spaces and return `{"message":"Hello <name>!"}`.

Put all target implementation files under `dst/`. The expected build command is:

```sh
mvn clean package -DskipTests
```

The expected run command is:

```sh
SERVER_PORT=3000 java -jar target/*.jar
```
