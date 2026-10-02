import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.block.BasicBlockModel;
import ghidra.program.model.block.CodeBlock;
import ghidra.program.model.block.CodeBlockIterator;
import ghidra.program.model.block.CodeBlockReference;
import ghidra.program.model.block.CodeBlockReferenceIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;

import java.io.File;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;

/**
 * ExportFunctionCFG — Stage 1 of Halo 2 Static Recompilation.
 *
 * Extracts function boundaries, basic blocks, control flow edges, and disassembled
 * instructions from halo2.exe into structured JSON format for the AOT WebAssembly lifter.
 *
 * Usage:
 *   analyzeHeadless <projdir> halo2 -process halo2.exe -noanalysis -scriptPath <scriptdir> \
 *     -postScript ExportFunctionCFG.java [outfile.json] [maxFunctions]
 */
public class ExportFunctionCFG extends GhidraScript {

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        String outPath = args.length > 0 ? args[0] : "cfg_export.json";
        int maxFuncs = args.length > 1 ? Integer.parseInt(args[1]) : 100; // default 100 for prototype, 0 for all

        File outFile = new File(outPath);
        Listing listing = currentProgram.getListing();
        BasicBlockModel bbModel = new BasicBlockModel(currentProgram);
        long imgBase = currentProgram.getImageBase().getOffset();

        println("Exporting CFG to: " + outFile.getAbsolutePath());
        println("Image Base: 0x" + Long.toHexString(imgBase));
        println("Max Functions: " + (maxFuncs > 0 ? maxFuncs : "ALL"));

        try (PrintWriter w = new PrintWriter(outFile, "UTF-8")) {
            w.println("{");
            w.println("  \"program\": \"" + currentProgram.getName() + "\",");
            w.println("  \"imageBase\": \"0x" + Long.toHexString(imgBase) + "\",");
            w.println("  \"functions\": [");

            FunctionIterator fIter = listing.getFunctions(true);
            int exportedCount = 0;
            boolean firstFunc = true;

            while (fIter.hasNext()) {
                Function fn = fIter.next();
                if (fn.isThunk()) continue; // Skip import thunks (handled via Win32 HLE runtime)

                if (!firstFunc) {
                    w.println(",");
                }
                firstFunc = false;

                long fnEntry = fn.getEntryPoint().getOffset();
                long fnRva = fnEntry - imgBase;

                w.println("    {");
                w.println("      \"name\": \"" + escapeJson(fn.getName()) + "\",");
                w.println("      \"entry\": \"0x" + Long.toHexString(fnEntry) + "\",");
                w.println("      \"rva\": \"0x" + Long.toHexString(fnRva) + "\",");
                w.println("      \"size\": " + fn.getBody().getNumAddresses() + ",");
                w.println("      \"basicBlocks\": [");

                CodeBlockIterator bbIter = bbModel.getCodeBlocksContaining(fn.getBody(), monitor);
                boolean firstBlock = true;

                while (bbIter.hasNext()) {
                    CodeBlock block = bbIter.next();
                    if (!firstBlock) {
                        w.println(",");
                    }
                    firstBlock = false;

                    long blockStart = block.getFirstStartAddress().getOffset();
                    long blockEnd = block.getMaxAddress().getOffset();

                    w.println("        {");
                    w.println("          \"start\": \"0x" + Long.toHexString(blockStart) + "\",");
                    w.println("          \"end\": \"0x" + Long.toHexString(blockEnd) + "\",");

                    // Instructions in basic block
                    w.println("          \"instructions\": [");
                    Instruction inst = listing.getInstructionAt(block.getFirstStartAddress());
                    boolean firstInst = true;
                    while (inst != null && inst.getAddress().compareTo(block.getMaxAddress()) <= 0) {
                        if (!firstInst) w.println(",");
                        firstInst = false;

                        long instAddr = inst.getAddress().getOffset();
                        String mnemonic = inst.getMnemonicString();
                        StringBuilder opStr = new StringBuilder();
                        for (int opIdx = 0; opIdx < inst.getNumOperands(); opIdx++) {
                            if (opIdx > 0) opStr.append(", ");
                            opStr.append(inst.getDefaultOperandRepresentation(opIdx));
                        }

                        w.print("            {\"addr\": \"0x" + Long.toHexString(instAddr) + "\", ");
                        w.print("\"len\": " + inst.getLength() + ", ");
                        w.print("\"mnemonic\": \"" + escapeJson(mnemonic) + "\", ");
                        w.print("\"ops\": \"" + escapeJson(opStr.toString()) + "\"}");

                        inst = inst.getNext();
                    }
                    w.println();
                    w.println("          ],");

                    // CFG Successors / Destinations
                    w.println("          \"destinations\": [");
                    CodeBlockReferenceIterator dstIter = block.getDestinations(monitor);
                    boolean firstDst = true;
                    while (dstIter.hasNext()) {
                        CodeBlockReference dstRef = dstIter.next();
                        if (!firstDst) w.println(",");
                        firstDst = false;

                        CodeBlock dstBlock = dstRef.getDestinationBlock();
                        Address dstAddr = dstBlock != null ? dstBlock.getFirstStartAddress() : dstRef.getDestinationAddress();
                        String flowType = dstRef.getFlowType().getName();

                        w.print("            {\"addr\": \"0x" + Long.toHexString(dstAddr.getOffset()) + "\", \"type\": \"" + escapeJson(flowType) + "\"}");
                    }
                    w.println();
                    w.println("          ]");
                    w.print("        }");
                }
                w.println();
                w.println("      ]");
                w.print("    }");

                exportedCount++;
                if (maxFuncs > 0 && exportedCount >= maxFuncs) {
                    break;
                }
            }

            w.println();
            w.println("  ]");
            w.println("}");
        }

        println("Export completed. Functions exported: " + outFile.length() + " bytes written.");
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\b", "\\b")
                .replace("\f", "\\f")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
