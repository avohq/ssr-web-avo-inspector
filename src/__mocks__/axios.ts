import axios from "axios";

let axiosDefaultMock = {
  post: jest.fn(() =>
    Promise.resolve({
      status: 200,
      data: {
        samplingRate: 1,
      },
    })
  ),
  status: 200,
  response: "{}",
};

(axios as any) = jest.fn(() => axiosDefaultMock);

export default axiosDefaultMock;
