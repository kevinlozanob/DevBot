# Usamos una imagen ligera de Java 17
FROM eclipse-temurin:17-jdk-alpine

# Creamos la carpeta de trabajo
WORKDIR /opt/lavalink

# Copiamos todo su repositorio adentro (incluyendo plugins y config)
COPY . .

# Comando para iniciar Lavalink
CMD ["java", "-jar", "Lavalink.jar"]

# Exponemos el puerto 8080
EXPOSE 8080