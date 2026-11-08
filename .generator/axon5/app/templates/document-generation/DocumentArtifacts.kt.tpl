package <%= rootPackage %>.documentgeneration.infrastructure

import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import java.util.Properties

class LocalDocumentArtifactStore(properties:DocumentProperties):DocumentArtifactStore {
 private val root=Path.of(properties.storagePath).toAbsolutePath().normalize()
 private fun directory(id:UUID)=root.resolve(id.toString())
 private fun syncDirectory(path:Path) {
  java.nio.channels.FileChannel.open(path,java.nio.file.StandardOpenOption.READ).use {it.force(true)}
 }
 override fun find(documentId:UUID,inputHash:String):DocumentArtifact? {
  val dir=directory(documentId);if(!Files.exists(dir)) return null
  val info=Properties();Files.newInputStream(dir.resolve("receipt.properties")).use {info.load(it)}
  require(info.getProperty("inputHash")==inputHash) { "Artifact belongs to different frozen inputs" }
  val file=dir.resolve("result.pdf");require(Files.size(file) in 1..33554432)
  val bytes=Files.readAllBytes(file);val hash=documentHash(bytes)
  require(info.getProperty("sha256")==hash) { "Document artifact checksum mismatch" }
  return DocumentArtifact("document:$documentId",hash,bytes.size.toLong())
 }
 override fun putIfAbsent(documentId:UUID,inputHash:String,bytes:ByteArray):DocumentArtifact {
  require(bytes.size in 1..33554432)
  find(documentId,inputHash)?.let {return it}
  Files.createDirectories(root)
  val staging=Files.createTempDirectory(root,".document-")
  try {
   val content=staging.resolve("result.pdf")
   java.nio.channels.FileChannel.open(content,java.nio.file.StandardOpenOption.CREATE_NEW,java.nio.file.StandardOpenOption.WRITE).use {channel ->
    val buffer=java.nio.ByteBuffer.wrap(bytes);while(buffer.hasRemaining()) channel.write(buffer);channel.force(true)
   }
   val receipt=Properties().apply {setProperty("inputHash",inputHash);setProperty("sha256",documentHash(bytes))}
   Files.newOutputStream(staging.resolve("receipt.properties")).use {receipt.store(it,"MEDOL immutable document")}
   java.nio.channels.FileChannel.open(staging.resolve("receipt.properties"),java.nio.file.StandardOpenOption.WRITE).use {it.force(true)}
   syncDirectory(staging)
   // Nonempty target directories cannot be replaced: concurrent renderers keep the first complete artifact.
   try {Files.move(staging,directory(documentId),java.nio.file.StandardCopyOption.ATOMIC_MOVE)}
   catch(e:java.nio.file.FileSystemException) {if(!Files.exists(directory(documentId))) throw e}
   syncDirectory(root)
   return requireNotNull(find(documentId,inputHash))
  } finally {
   if(Files.exists(staging)) {
    Files.deleteIfExists(staging.resolve("result.pdf"));Files.deleteIfExists(staging.resolve("receipt.properties"));Files.deleteIfExists(staging)
   }
  }
 }
 override fun read(documentId:UUID,inputHash:String,expectedHash:String):ByteArray {
  val artifact=requireNotNull(find(documentId,inputHash)) { "Document artifact missing" }
  require(artifact.sha256==expectedHash) { "Stored document differs from recorded artifact" }
  val bytes=Files.readAllBytes(directory(documentId).resolve("result.pdf"))
  require(documentHash(bytes)==expectedHash) { "Document changed during read" };return bytes
 }
}
