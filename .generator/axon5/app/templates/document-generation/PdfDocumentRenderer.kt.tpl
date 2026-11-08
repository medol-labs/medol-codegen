package <%= rootPackage %>.documentgeneration.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import org.springframework.stereotype.Component
import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.pdmodel.PDPage
import org.apache.pdfbox.pdmodel.PDPageContentStream
import org.apache.pdfbox.pdmodel.common.PDRectangle
import org.apache.pdfbox.pdmodel.font.PDFont
import org.apache.pdfbox.pdmodel.font.PDType0Font
import org.apache.pdfbox.pdmodel.font.PDType1Font
import org.apache.pdfbox.pdmodel.font.Standard14Fonts
import java.nio.file.Files
import java.nio.file.Path
import java.io.ByteArrayOutputStream

@Component
class PdfDocumentRenderer(private val properties:DocumentProperties,private val validation:DocumentValidation):DocumentRenderer {
 override val key="pdfbox-layout"
 private val token=Regex("\\{\\{\\s*([A-Za-z_][A-Za-z0-9_.]*)\\s*}}")
 private fun fontBytes():ByteArray? {
  if(properties.fontPath.isBlank()) return null
  val path=Path.of(properties.fontPath);require(Files.size(path) in 1..33554432) { "Font must be a TTF of at most 32 MiB" };return Files.readAllBytes(path)
 }
 override fun version():String {
  require(properties.maxPages in 1..1000)
  return "pdfbox-3.0.8/layout-2/pages-${properties.maxPages}/font-${fontBytes()?.let(::documentHash) ?: "Helvetica"}"
 }
 private fun keys(node:JsonNode,allowed:Set<String>) {require(node.isObject && node.fieldNames().asSequence().all {it in allowed}) { "Unknown template attribute" }}
 private fun text(node:JsonNode?,root:DocumentField) {
  if(node==null) return
  require(node.isTextual && node.textValue().length<=10000)
  val source=node.asText()
  token.findAll(source).forEach {match->require(validation.field(root,match.groupValues[1]).type in setOf("string","number","boolean")) { "Text requires a scalar field" }}
  val remainder=token.replace(source,"");require(!remainder.contains("{{") && !remainder.contains("}}")) { "Invalid template expression" }
 }
 override fun validate(template:JsonNode,contract:DocumentContract) {
  validation.contract(contract);keys(template,setOf("title","header","footer","blocks"))
  text(template["title"],contract.root);text(template["header"],contract.root);text(template["footer"],contract.root)
  val blocks=template["blocks"];require(blocks!=null && blocks.isArray && blocks.size() in 1..200)
  for(b in blocks) {
   when(b["type"]?.asText()) {
    "text" -> {keys(b,setOf("type","text"));require(b.has("text"));text(b["text"],contract.root)}
    "pageBreak" -> keys(b,setOf("type"))
    "table" -> {
     keys(b,setOf("type","items","columns"));require(b["items"]?.isTextual==true)
     val array=validation.field(contract.root,b["items"].asText());require(array.type=="array" && array.items?.type=="object")
     val columns=b["columns"];require(columns!=null && columns.isArray && columns.size() in 1..8)
     columns.forEach {c -> keys(c,setOf("label","field"));require(c["label"]?.isTextual==true && c["label"].asText().length<=200 && c["field"]?.isTextual==true);require(validation.field(requireNotNull(array.items),c["field"].asText()).type in setOf("string","number","boolean"))}
    }
    else -> throw IllegalArgumentException("Unsupported layout block")
   }
  }
 }
 private fun interpolate(text:String,data:JsonNode)=token.replace(text) {validation.value(data,it.groupValues[1])?.asText() ?: ""}
 override fun render(template:JsonNode,data:JsonNode):ByteArray {
  val fontData=fontBytes()
  PDDocument().use {doc ->
   val font:PDFont=if(fontData==null) PDType1Font(Standard14Fonts.FontName.HELVETICA) else fontData.inputStream().use {PDType0Font.load(doc,it,true)}
   val margin=42f;val width=PDRectangle.A4.width-2*margin;val size=10f;val line=15f
   var page=PDPage(PDRectangle.A4);var stream:PDPageContentStream?=null;var y=0f
   fun draw(value:String,x:Float,at:Float,fontSize:Float=size) {
    val s=requireNotNull(stream);s.beginText();s.setFont(font,fontSize);s.newLineAtOffset(x,at);s.showText(value);s.endText()
   }
   fun wrap(value:String,available:Float,fontSize:Float=size):List<String> {
    val lines=mutableListOf<String>();var current=""
    for(cp in value.replace("\r\n","\n").replace('\r','\n').codePoints().toArray()) {
     if(cp==10) {lines.add(current);current="";continue}
     val character=if(cp==9) "    " else String(Character.toChars(cp))
     require(cp==9 || cp>=32) { "Unsupported control character" }
     require(font.getStringWidth(character)/1000*fontSize<=available) { "Glyph wider than layout column" }
     if(current.isNotEmpty() && font.getStringWidth(current+character)/1000*fontSize>available) {lines.add(current);current=""}
     current+=character
    }
    lines.add(current);return lines
   }
   fun newPage() {
    require(doc.numberOfPages<properties.maxPages) { "Document page limit exceeded" }
    stream?.close();page=PDPage(PDRectangle.A4);doc.addPage(page);stream=PDPageContentStream(doc,page)
    y=page.mediaBox.height-margin
    val header=interpolate(template["header"]?.asText() ?: "",data)
    val footer=interpolate(template["footer"]?.asText() ?: "",data)
    val headerLines=wrap(header,width);val footerLines=wrap(footer,width-50)
    require(headerLines.size<=3 && footerLines.size<=2) { "Header/footer exceeds reserved space" }
    headerLines.forEach {draw(it,margin,y,9f);y-=line};y-=line
    footerLines.forEachIndexed {index,value->draw(value,margin,margin-10+index*line,9f)}
    draw(doc.numberOfPages.toString(),page.mediaBox.width-margin-25,margin-10,9f)
   }
   fun ensure(height:Float) {if(y-height<margin+2*line) newPage()}
   fun paragraph(value:String) {for(part in wrap(value,width)) {ensure(line);draw(part,margin,y);y-=line};y-=line/2}
   try {
    newPage()
    template["title"]?.let {paragraph(interpolate(it.asText(),data));y-=line/2}
    for(b in template["blocks"]) when(b["type"].asText()) {
     "text" -> paragraph(interpolate(b["text"].asText(),data))
     "pageBreak" -> newPage()
     "table" -> {
      val columns=b["columns"].toList();val columnWidth=width/columns.size
      val labels=columns.map {it["label"].asText()}
      fun row(values:List<String>,header:Boolean=false) {
       val cells=values.map {wrap(it,columnWidth-8)};val count=cells.maxOf {it.size}
       if(header) {
        val requiredHeight=count*line+10+line
        if(y-requiredHeight<margin+2*line) newPage()
        require(y-requiredHeight>=margin+2*line) { "Table header leaves no space for a data row" }
       }
       for(i in 0 until count) {
        if(!header && y-line<margin+2*line) {newPage();row(labels,true)} else ensure(line)
        cells.forEachIndexed {index,parts -> draw(parts.getOrElse(i){""},margin+index*columnWidth+4,y)}
        y-=line
       }
       requireNotNull(stream).apply {moveTo(margin,y+4);lineTo(margin+width,y+4);stroke()};y-=10
      }
      row(labels,true)
      val rows=validation.value(data,b["items"].asText())
      rows?.forEach {item->
       if(y-line<margin+2*line) {newPage();row(labels,true)}
       row(columns.map {validation.value(item,it["field"].asText())?.asText() ?: ""})
      }
      y-=line/2
     }
    }
    stream?.close();stream=null
    return ByteArrayOutputStream().use {out->doc.save(out);out.toByteArray()}
   } finally {stream?.close()}
  }
 }
}
