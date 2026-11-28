FROM eclipse-temurin:21-jdk-alpine

WORKDIR /app

COPY src ./src
COPY data ./data
COPY sql ./sql

RUN mkdir -p target/classes && \
    javac -d target/classes \
    src/main/java/com/foodrescue/util/DistanceCalculator.java \
    src/main/java/com/foodrescue/model/FoodBatch.java \
    src/main/java/com/foodrescue/model/AlertEvent.java \
    src/main/java/com/foodrescue/service/ExpiryPriorityQueueService.java \
    src/main/java/com/foodrescue/FoodRescueServer.java

EXPOSE 8080

CMD ["java", "-cp", "target/classes", "com.foodrescue.FoodRescueServer"]
