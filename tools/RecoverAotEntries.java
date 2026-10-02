import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

/** Recover verified indirect-call entry points omitted by initial analysis. */
public class RecoverAotEntries extends GhidraScript {
    @Override protected void run() throws Exception {
        for (String value : getScriptArgs()) {
            Address entry = toAddr(Long.decode(value));
            Function existing = getFunctionAt(entry);
            if (existing != null) { println("Already defined: " + existing.getName()); continue; }
            Function parent = getFunctionContaining(entry);
            if (parent != null) { println("Covered by " + parent.getName() + ": " + entry); continue; }
            disassemble(entry);
            Function created = createFunction(entry, "AOT_recovered_" + entry.toString());
            if (created == null) throw new IllegalStateException("Could not create function at " + entry);
            println("Recovered " + created.getName() + " body=" + created.getBody());
        }
    }
}
