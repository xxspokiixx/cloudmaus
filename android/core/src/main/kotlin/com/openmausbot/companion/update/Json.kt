package com.openmausbot.companion.update

internal sealed class JsonValue {
    data class Obj(val fields: Map<String, JsonValue>) : JsonValue()
    data class Arr(val items: List<JsonValue>) : JsonValue()
    data class Str(val text: String) : JsonValue()
    data class IntNum(val value: Long) : JsonValue()
    data class Bool(val value: Boolean) : JsonValue()
    data object Null : JsonValue()
}

internal class JsonParseException(message: String) : IllegalArgumentException(message)

/** The subset of JSON a GitHub release document uses. Numbers must be integers. */
internal fun parseJson(text: String): JsonValue = JsonParser(text).parse()

private class JsonParser(private val text: String) {
    private var i = 0
    private var depth = 0

    fun parse(): JsonValue {
        val value = readValue()
        skip()
        if (i != text.length) fail("trailing data")
        return value
    }

    private fun readValue(): JsonValue {
        skip()
        if (i >= text.length) fail("unexpected end")
        return when (val c = text[i]) {
            '{' -> readObject()
            '[' -> readArray()
            '"' -> JsonValue.Str(readString())
            't' -> literal("true", JsonValue.Bool(true))
            'f' -> literal("false", JsonValue.Bool(false))
            'n' -> literal("null", JsonValue.Null)
            '-', in '0'..'9' -> readNumber()
            else -> fail("unexpected '${c}'")
        }
    }

    private fun readObject(): JsonValue.Obj {
        expect('{')
        nest()
        val fields = linkedMapOf<String, JsonValue>()
        skip()
        if (peek('}')) {
            i++
            depth--
            return JsonValue.Obj(fields)
        }
        while (true) {
            skip()
            if (i >= text.length || text[i] != '"') fail("expected a key")
            val key = readString()
            skip()
            expect(':')
            fields[key] = readValue()
            skip()
            when {
                peek(',') -> i++
                peek('}') -> {
                    i++
                    depth--
                    return JsonValue.Obj(fields)
                }
                else -> fail("expected ',' or '}'")
            }
        }
    }

    private fun readArray(): JsonValue.Arr {
        expect('[')
        nest()
        val items = mutableListOf<JsonValue>()
        skip()
        if (peek(']')) {
            i++
            depth--
            return JsonValue.Arr(items)
        }
        while (true) {
            items.add(readValue())
            skip()
            when {
                peek(',') -> i++
                peek(']') -> {
                    i++
                    depth--
                    return JsonValue.Arr(items)
                }
                else -> fail("expected ',' or ']'")
            }
        }
    }

    private fun readString(): String {
        expect('"')
        val out = StringBuilder()
        while (i < text.length) {
            val c = text[i++]
            when {
                c == '"' -> return out.toString()
                c == '\\' -> out.append(escape())
                c < ' ' -> fail("unescaped control")
                else -> out.append(c)
            }
        }
        fail("unterminated string")
    }

    private fun escape(): Char {
        if (i >= text.length) fail("bad escape")
        return when (val c = text[i++]) {
            '"', '\\', '/' -> c
            'b' -> '\b'
            'f' -> '\u000c'
            'n' -> '\n'
            'r' -> '\r'
            't' -> '\t'
            'u' -> {
                if (i + 4 > text.length) fail("bad unicode")
                val hex = text.substring(i, i + 4)
                i += 4
                val code = hex.toIntOrNull(16) ?: fail("bad unicode")
                code.toChar()
            }
            else -> fail("bad escape")
        }
    }

    private fun readNumber(): JsonValue.IntNum {
        val start = i
        if (peek('-')) i++
        if (i >= text.length || text[i] !in '0'..'9') fail("bad number")
        if (text[i] == '0') i++ else while (i < text.length && text[i] in '0'..'9') i++
        if (i < text.length && text[i] in ".eE") fail("only integers")
        val raw = text.substring(start, i)
        val value = raw.toLongOrNull() ?: fail("integer out of range")
        return JsonValue.IntNum(value)
    }

    private fun literal(word: String, value: JsonValue): JsonValue {
        if (!text.startsWith(word, i)) fail("expected $word")
        i += word.length
        return value
    }

    private fun nest() {
        if (++depth > 32) fail("too deep")
    }

    private fun skip() {
        while (i < text.length && text[i] in " \n\r\t") i++
    }

    private fun peek(c: Char) = i < text.length && text[i] == c

    private fun expect(c: Char) {
        if (!peek(c)) fail("expected '$c'")
        i++
    }

    private fun fail(message: String): Nothing = throw JsonParseException(message)
}
