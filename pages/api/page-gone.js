export default function pageGone(_request, response) {
  response.status(410).send('This page is no longer available.');
}
