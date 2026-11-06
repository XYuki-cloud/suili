package app.flexible.calendar;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Host-only bridge used to verify real Node -> Java -> Node protocol interoperation. */
public final class ProtocolRoundtrip {
    public static void main(String[] args) throws Exception {
        List<Core.Op> operations=JsonCodec.decode(Files.readString(Path.of(args[0]),StandardCharsets.UTF_8));
        String encoded=JsonCodec.encode(operations);
        if(!operations.equals(JsonCodec.decode(encoded)))throw new AssertionError("Java encode/decode changed operations");
        Files.writeString(Path.of(args[1]),encoded,StandardCharsets.UTF_8);
        if(args.length==5){
            Core.Task task=operations.stream().filter(op->op.id.equals(args[3])).findFirst().orElseThrow().task;
            Files.writeString(Path.of(args[2]),JsonCodec.task(Core.toNextWeek(task,args[4])).toString(),StandardCharsets.UTF_8);
        }
        System.out.println("Java protocol roundtrip: "+operations.size()+" operations");
    }
}
